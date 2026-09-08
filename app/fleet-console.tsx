'use client';
import { sampleTraffic, SAMPLE_PHASES, SAMPLE_LABELS, type SamplePhase } from '@/lib/sample-traffic';
import Link from 'next/link';
import ThemeToggle from '@/components/theme-toggle';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Layers3,
  FlaskConical,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  Download,
  ShieldCheck,
  Check,
  ChevronRight,
  ArrowDownRight,
  ArrowUpRight,
  Zap,
  LoaderCircle,
  X,
  GitBranch,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import FleetMap from '@/components/fleet-map';
import DemoScenarios from '@/components/demo-scenarios';
import FleetDeployment from '@/components/fleet-deployment';
import GcpConnection from '@/components/gcp-connection';
import AstraAnalysis from '@/components/astra-analysis';
import type { AnalysisResult } from '@/components/astra-analysis';
import SavedWorkloads from '@/components/saved-workloads';
import { sweepConfiguration } from '@/lib/config-sweep';
import type { DemoScenario } from '@/lib/fleet-scenarios';
import {
  createFleetState,
  evaluateProfile,
  recommendProfiles,
  updateWorkload,
  MODEL_IDS,
  MODELS,
  INITIAL_NODES,
} from '@/lib/fleet-engine';
import type {
  FleetModelId,
  FleetProfile,
  WorkloadConfig,
  Evaluation,
} from '@/lib/fleet-engine';
import {
  proposeFleetChange,
  ROLLOUT_CAPACITY_NOTE,
  fleetContextHash,
} from '@/lib/fleet-rollout';
import type { Proposal, RolloutPhase } from '@/lib/fleet-rollout';
import {
  tickSession,
  beginSessionRollout,
  abortSessionRollout,
  liveRollout,
  sessionSummary,
} from '@/lib/fleet-session';
import type { FleetSession } from '@/lib/fleet-session';
import './fleet-console.css';
import './fleet-map.css';
import './fleet-deployment.css';
import './gcp-connection.css';

type Experiment = ReturnType<typeof recommendProfiles>[number] & {
  aiReason?: string;
  aiRisks?: string[];
};
type Evidence = {
  workload: WorkloadConfig;
  source?: 'simulation' | 'observed-proxy';
  aiModel?: string;
  context: string;
  baseline: Evaluation;
  experiments: Experiment[];
};
type Audit = { time: string; message: string };
const currency = (n: number, d = 2) => `$${n.toFixed(d)}`;
const number = (n: number) => Math.round(n).toLocaleString();
const fraction = (n: number) => `${(n * 100).toFixed(1)}%`;
const PHASES: RolloutPhase[] = [
  'warming',
  'canary',
  'migrating',
  'verifying',
  'draining',
  'complete',
];
const PHASE_LABELS: Record<string, string> = {
  warming: 'Warm green',
  canary: '10% canary',
  migrating: 'Migrate traffic',
  verifying: 'Verify targets',
  draining: 'Drain blue',
  complete: 'Green active',
  'rolled-back': 'Rolled back',
  failed: 'Failed',
};
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));
function exportJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function deploymentLines(profile: FleetProfile, model: FleetModelId) {
  return (
    profile.placements
      .filter((p) => p.model === model)
      .map(
        (p) =>
          `${p.replicas}× on ${INITIAL_NODES.find((n) => n.id === p.nodeId)?.label || p.nodeId}`,
      )
      .join(' + ') || 'No replica'
  );
}
function Delta({
  before,
  after,
  unit = '',
  lower = true,
}: {
  before: number;
  after: number;
  unit?: string;
  lower?: boolean;
}) {
  const change = before ? (after - before) / before : 0;
  return (
    <span
      className={
        change === 0
          ? 'delta-neutral'
          : (lower ? change < 0 : change > 0)
            ? 'delta-good'
            : 'delta-warn'
      }
    >
      {change === 0 ? (
        'Unchanged'
      ) : (
        <>
          {change < 0 ? (
            <ArrowDownRight size={13} />
          ) : (
            <ArrowUpRight size={13} />
          )}{' '}
          {Math.abs(change * 100).toFixed(1)}% {change < 0 ? 'lower' : 'higher'}
        </>
      )}
      <small>
        {after.toFixed(unit === 'ms' ? 0 : 1)}
        {unit}
      </small>
    </span>
  );
}
function Control({
  title,
  value,
  min,
  max,
  step = 1,
  onChange,
  description,
  format,
  disabled,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  description: string;
  format?: (n: number) => string;
  disabled: boolean;
}) {
  return (
    <div className="fleet-control">
      <div>
        <span>{title}</span>
        <strong>{format ? format(value) : number(value)}</strong>
      </div>
      <Slider
        aria-label={title}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
      <p>{description}</p>
    </div>
  );
}
export default function FleetConsole() {
  const [session, setSession] = useState<FleetSession>(() => ({
    fleet: createFleetState(),
    green: null,
    rollout: null,
  }));
  const [playing, setPlaying] = useState(true);
  const [samplePhase, setSamplePhase] = useState<SamplePhase | null>(null);
  const [speed, setSpeed] = useState(2);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [inspected, setInspected] = useState<Experiment | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('experiments');
  const [screen, setScreen] = useState<'live' | 'simulation' | 'optimization'>(
    'live',
  );
  const [source, setSource] = useState<'simulation' | 'gke'>('simulation');
  const observedMode = source === 'gke';
  const [assumptions, setAssumptions] = useState(false);
  const [pattern, setPattern] = useState('mixed');
  const [audit, setAudit] = useState<Audit[]>([]);
  const [history, setHistory] = useState<
    {
      time: number;
      gemma: number;
      qwen: number;
      kimi: number;
      blue: number;
      green: number;
    }[]
  >([]);
  const ids = useRef(new Set<string>());
  const current = useRef(session);
  const operation = useRef(0);
  const running = useRef(false);
  const dataRef = useRef({ session, evidence });
  useEffect(() => {
    current.current = session;
    dataRef.current = { session, evidence };
  });
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setSession((old) => tickSession(old)),
      1000 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed]);
  useEffect(() => {
    const time = session.fleet.time;
    if (time === 0) return;
    const activeRps = MODEL_IDS.reduce(
      (sum, m) => sum + session.fleet.modelMetrics[m].incomingRps,
      0,
    );
    const greenRps = MODEL_IDS.reduce(
      (sum, m) => sum + (session.green?.modelMetrics[m].incomingRps || 0),
      0,
    );
    const point = {
      time,
      blue: session.rollout?.phase === 'complete' ? 0 : activeRps,
      green: session.rollout?.phase === 'complete' ? activeRps : greenRps,
      ...Object.fromEntries(
        MODEL_IDS.map((m) => [
          m,
          session.fleet.modelMetrics[m].incomingRps +
            (session.green?.modelMetrics[m].incomingRps || 0),
        ]),
      ),
    } as {
      time: number;
      gemma: number;
      qwen: number;
      kimi: number;
      blue: number;
      green: number;
    };
    queueMicrotask(() =>
      setHistory((old) =>
        [...old.filter((p) => p.time !== time), point].slice(-75),
      ),
    );
  }, [
    session.fleet.time,
    session.fleet.modelMetrics,
    session.green,
    session.rollout?.phase,
  ]);
  const locked = liveRollout(session.rollout);
  const disabled = locked || busy;
  const workload = locked ? session.rollout!.workload : session.fleet.workload;
  const summary = sessionSummary(session);
  const activeProfile = locked ? session.rollout!.blue : session.fleet.profile;
  function log(text: string) {
    setAudit((old) =>
      [{ time: new Date().toISOString(), message: text }, ...old].slice(0, 30),
    );
  }
  function invalidate() {
    setSamplePhase(null);
    operation.current++;
    setEvidence(null);
    setInspected(null);
    setProposal(null);
    setMessage('');
  }
  function setWorkload(next: WorkloadConfig) {
    if (disabled) return;
    invalidate();
    setPlaying(true);
    setSession((s) => ({
      ...s,
      fleet: updateWorkload(s.fleet, next),
      rollout: null,
    }));
  }
  function change<K extends keyof WorkloadConfig>(
    key: K,
    value: WorkloadConfig[K],
  ) {
    setWorkload({ ...workload, [key]: value });
  }
  function surge(model: FleetModelId | 'all') {
    if (disabled) return;
    const sum = MODEL_IDS.reduce((n, m) => n + workload.mix[m], 0) || 1;
    const rates = Object.fromEntries(
      MODEL_IDS.map((m) => [
        m,
        ((workload.rps * workload.mix[m]) / sum) *
          (model === 'all' || model === m ? 2.5 : 1),
      ]),
    ) as Record<FleetModelId, number>;
    const rps = MODEL_IDS.reduce((n, m) => n + rates[m], 0);
    setWorkload({
      ...workload,
      rps: Math.min(300, rps),
      mix: Object.fromEntries(
        MODEL_IDS.map((m) => [m, rates[m] / Math.max(1, rps)]),
      ) as Record<FleetModelId, number>,
    });
    setPlaying(true);
    log(
      `2.5× demand surge for ${model === 'all' ? 'all models' : MODELS[model].name}.`,
    );
  }
  function applyPattern(value: string) {
    setPattern(value);
    const presets: Record<string, Partial<WorkloadConfig>> = {
      mixed: {
        inputTokens: 1200,
        outputTokens: 300,
        sharedPrefix: 0.65,
        burstiness: 0.15,
      },
      prefill: {
        inputTokens: 6000,
        outputTokens: 180,
        sharedPrefix: 0.6,
        burstiness: 0.1,
      },
      code: {
        inputTokens: 1800,
        outputTokens: 1200,
        sharedPrefix: 0.25,
        burstiness: 0.2,
      },
      prefix: {
        inputTokens: 3500,
        outputTokens: 220,
        sharedPrefix: 0.9,
        burstiness: 0.1,
      },
      bursty: {
        inputTokens: 1200,
        outputTokens: 300,
        sharedPrefix: 0.65,
        burstiness: 0.85,
      },
    };
    setWorkload({ ...workload, ...presets[value] });
  }
  function reset() {
    if (busy) return;
    setSamplePhase(null);
    operation.current++;
    setSession({ fleet: createFleetState(), green: null, rollout: null });
    setEvidence(null);
    setInspected(null);
    setProposal(null);
    setHistory([]);
    setPattern('mixed');
    setMessage('Fleet and workload reset to the reproducible baseline.');
    setPlaying(true);
    ids.current.clear();
    log('Reset simulation to baseline.');
  }
  function loadScenario(scenario: DemoScenario) {
    if (disabled) return;
    invalidate();
    setSession({
      fleet: createFleetState(scenario.profile, scenario.workload, 42),
      green: null,
      rollout: null,
    });
    setPlaying(false);
    setHistory([]);
    setPattern('mixed');
    ids.current.clear();
    setMessage(scenario.steps);
    log(
      `Loaded ${scenario.title}: initial placements, seed 42, autoscaling off.`,
    );
  }
  async function analyze() {
    if (running.current || locked || observedMode) return;
    running.current = true;
    setBusy(true);
    setPlaying(false);
    setMessage('');
    setInspected(null);
    setProposal(null);
    const rev = ++operation.current;
    const captured = current.current;
    try {
      await nextFrame();
      const baseline = evaluateProfile(
        { ...captured.fleet.profile, autoscale: false },
        captured.fleet.workload,
      );
      const grid = sweepConfiguration(
        captured.fleet.profile,
        captured.fleet.workload,
      );
      const experiments = grid.shortlist;
      if (rev !== operation.current) return;
      setEvidence({
        source: 'simulation',
        workload: structuredClone(captured.fleet.workload),
        context: fleetContextHash(
          captured.fleet.profile,
          captured.fleet.workload,
        ),
        baseline,
        experiments,
      });
      setTab('experiments');
      setScreen('optimization');
      setMessage(
        `${grid.feasibleCount} of ${grid.evaluatedCount} configurations passed the 90-second replay. Showing ${experiments.length} representative profiles; ask Astra to rank and explain the sweep.`,
      );
      log(
        'Evaluated candidate deployment profiles on identical offered traffic.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function receiveAnalysis(result: AnalysisResult) {
    setInspected(null);
    setProposal(null);
    const ranked = result.decision?.recommendations || [];
    const selected =
      result.decision !== null
        ? ranked.map((r) => {
            const c = result.sweep.candidates.find(
              (c) => c.id === r.candidateId,
            )!;
            return { ...c, aiReason: r.reason, aiRisks: r.risks };
          })
        : result.sweep.shortlist;
    setEvidence({
      source: result.source,
      aiModel: result.decision?.model,
      workload: result.workload,
      context: fleetContextHash(result.profile, result.workload),
      baseline: evaluateProfile(
        { ...result.profile, autoscale: false },
        result.workload,
      ),
      experiments: selected,
    });
    setTab('experiments');
    setPlaying(false);
    setMessage(
      result.source === 'observed-proxy'
        ? 'Astra reviewed observed metrics. These profiles remain modeled proposals; cloud deployment approval is unavailable.'
        : 'Astra recommendations are ready. Inspect the evidence and exact profile before approval.',
    );
  }
  function inspect(experiment: Experiment) {
    setPlaying(false);
    setInspected(experiment);
    try {
      if (observedMode || evidence?.source === 'observed-proxy')
        throw Error(
          'Observed telemetry recommendations require calibrated benchmarks and a cloud deployment adapter. Review only.',
        );
      if (
        !evidence ||
        evidence.context !==
          fleetContextHash(session.fleet.profile, session.fleet.workload)
      )
        throw Error(
          'The fleet changed after these experiments. Run optimization again.',
        );
      setProposal(
        proposeFleetChange(
          session.fleet.profile,
          experiment.profile,
          session.fleet.workload,
          experiment.prescription,
        ),
      );
    } catch (e) {
      setProposal(null);
      setMessage((e as Error).message);
    }
  }
  function approve() {
    if (!proposal || observedMode || evidence?.source === 'observed-proxy')
      return;
    try {
      const next = beginSessionRollout(
        current.current,
        { ...proposal, status: 'approved' },
        ids.current,
      );
      setSession(next);
      setProposal(null);
      setInspected(null);
      setEvidence(null);
      setScreen('live');
      setPlaying(true);
      setMessage(
        'Approved. Warming a separate green pool before migrating traffic.',
      );
      log(`Approved ${next.rollout!.green.name}; blue-green rollout started.`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function abort() {
    setSession((s) => abortSessionRollout(s));
    setMessage(
      'Rollout aborted. Pending requests are preserved and traffic is restored to blue.',
    );
    log('Operator rolled back to blue.');
  }
  function downloadReport() {
    exportJson('fleet-simulation-report.json', {
      version: 2,
      evidenceType: 'synthetic simulation',
      models: MODELS,
      inventory: INITIAL_NODES,
      workload,
      session,
      evidence,
      audit,
      assumptions: ROLLOUT_CAPACITY_NOTE,
    });
  }
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => unknown;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'read_fleet_simulation',
            description:
              'Read the visible simulated fleet and blue-green traffic migration. This does not change cloud resources.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: (input: unknown) => {
              if (
                !input ||
                typeof input !== 'object' ||
                Object.keys(input).length
              )
                throw Error('Expected an empty object.');
              return {
                evidence: 'simulation',
                summary: sessionSummary(dataRef.current.session),
                workload: dataRef.current.session.fleet.workload,
                rollout: dataRef.current.session.rollout,
                experiments: dataRef.current.evidence,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  const sumMix = MODEL_IDS.reduce((n, m) => n + workload.mix[m], 0) || 1;
  return (
    <div className="app-shell fleet-console">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>
          inference<span>autopilot</span>
        </Link>
        <div className="environment">
          <span className="status-dot" />{' '}
          {observedMode ? 'GKE observation' : 'Simulation'}{' '}
          <span className="divider">/</span> heterogeneous-lab
        </div>
        <Link className="small-badge" href="/lab">
          Single GPU & node lab <ArrowRight size={12} />
        </Link>
        <ThemeToggle />
      </header>
      <main className="workspace fleet-workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">FLEET ORCHESTRATION</div>
            <h1>
              Fleet orchestration<span className="title-dot">.</span>
            </h1>
            <p>
              {screen === 'live'
                ? 'Request flow, serving capacity, and deployment health.'
                : screen === 'simulation'
                  ? 'Shape demand and test how the fleet responds.'
                  : 'Compare recommendations against the baseline, then review and approve.'}
            </p>
          </div>
          <div className="heading-actions">
            <span className="sim-badge">
              <FlaskConical size={16} />{' '}
              {observedMode
                ? 'Snapshot · not live telemetry'
                : 'Simulation · no cloud resources'}
            </span>
            <div>
              <Button variant="outline" onClick={() => setAssumptions(true)}>
                <Info /> Model & hardware assumptions
              </Button>
              <Button variant="outline" onClick={downloadReport}>
                <Download /> Export
              </Button>
            </div>
          </div>
        </div>
        <nav className="journey-nav" aria-label="Workspace screens">
          <div>
            {(
              [
                ['live', 'Live fleet'],
                ['optimization', 'Optimization'],
                ['simulation', 'Simulation'],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                variant={screen === id ? 'secondary' : 'ghost'}
                aria-current={screen === id ? 'page' : undefined}
                onClick={() => {
                  setScreen(id);
                  if (id === 'simulation') { setSource('simulation'); setPlaying(true); }
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Select
            value={source}
            onValueChange={(v) => {
              if (v === 'simulation' || v === 'gke') {
                setSamplePhase(null);
                setSource(v);
                setScreen('live');
                if (v === 'gke') setPlaying(false);
              }
            }}
          >
            <SelectTrigger aria-label="Fleet data source">
              <SelectValue>
                {observedMode ? 'GKE snapshot' : 'Simulated fleet'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simulation">Simulated fleet</SelectItem>
              <SelectItem value="gke">GKE snapshot · read-only</SelectItem>
            </SelectContent>
          </Select>
        </nav>
        <div className="fleet-toolbar">
          <div className="playback">
            <Button
              variant="secondary"
              disabled={busy || observedMode}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}{' '}
              {playing ? 'Pause' : 'Run'}
            </Button>
            <span className="simulation-clock">
              {observedMode ? (
                'No live stream'
              ) : (
                <>
                  T+
                  {String(Math.floor(session.fleet.time / 60)).padStart(2, '0')}
                  :{String(session.fleet.time % 60).padStart(2, '0')}
                </>
              )}
            </span>
            <Select
              disabled={observedMode}
              value={String(speed)}
              onValueChange={(v) => setSpeed(Number(v))}
            >
              <SelectTrigger aria-label="Simulation playback speed">
                <SelectValue>{speed}× speed</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 4].map((v) => (
                  <SelectItem value={String(v)} key={v}>
                    {v}× speed
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="toolbar-actions">
            <div className="autoscale-switch">
              <Switch
                id="autoscale"
                checked={activeProfile.autoscale}
                disabled={disabled || observedMode}
                onCheckedChange={(value) => {
                  invalidate();
                  setSession((s) => ({
                    ...s,
                    fleet: {
                      ...s.fleet,
                      profile: { ...s.fleet.profile, autoscale: value },
                    },
                  }));
                }}
              />
              <label htmlFor="autoscale">Auto-scale</label>
            </div>
            <Button
              variant="outline"
              onClick={() => surge('all')}
              disabled={disabled || observedMode}
            >
              <Zap /> Surge all models
            </Button>
            <Button variant="outline" onClick={() => setScreen('optimization')}>
              Model decisions <ArrowRight size={14} />
            </Button>
            <Button
              variant="ghost"
              onClick={reset}
              disabled={disabled || observedMode}
            >
              <RotateCcw /> Reset
            </Button>
          </div>
        </div>
        {(screen === 'live' || screen === 'simulation') && !observedMode && (
          <>
            <section className="panel fleet-map-panel">
              <div className="panel-heading">
                <div>
                  <h2>Live routing & placement</h2>
                  <p>
                    {locked
                      ? 'Blue and green are isolated pools; traffic split is applied to both simulations.'
                      : 'Compatible accelerators only. A model stays the same as it moves or scales.'}
                  </p>
                </div>
                <div className="health-key">
                  <span>
                    <i className="green-dot" />
                    Healthy
                  </span>
                  <span>
                    <i className="yellow-dot" />
                    Pressure
                  </span>
                  <span>
                    <i className="red-dot" />
                    Saturated
                  </span>
                </div>
              </div>
              <FleetMap
                state={session.fleet}
                green={session.green}
                greenTraffic={(session.rollout?.greenTraffic || 0) / 100}
                playing={playing}
                onSurge={surge}
                locked={disabled}
              />
            </section>
            <div className="fleet-metrics">
              <div>
                <span>Modeled compute {locked ? '· overlap' : ''}</span>
                <strong>
                  {currency(summary.hourlyCost)}
                  <em>/hr</em>
                </strong>
                <small>
                  {summary.activeReplicas} replicas · {summary.readyReplicas}{' '}
                  ready
                </small>
              </div>
              <div>
                <span>Estimated first token</span>
                <strong
                  className={
                    summary.ttftMs > workload.ttftTargetMs ? 'warning-text' : ''
                  }
                >
                  {number(summary.ttftMs)}
                  <em>ms</em>
                </strong>
                <small>
                  Traffic-weighted estimate · target {workload.ttftTargetMs}ms
                </small>
              </div>
              <div>
                <span>Output throughput</span>
                <strong>
                  {number(summary.outputTokensPerSecond)}
                  <em>tok/s</em>
                </strong>
                <small>
                  {number(
                    session.fleet.completed + (session.green?.completed || 0),
                  )}{' '}
                  completed requests · fluid estimate
                </small>
              </div>
              <div>
                <span>Capacity pressure</span>
                <strong
                  className={
                    summary.utilization > 0.85
                      ? 'warning-text'
                      : summary.utilization < 0.65
                        ? 'success-text'
                        : ''
                  }
                >
                  {fraction(summary.utilization)}
                </strong>
                <small>
                  {number(summary.queue)} queued ·{' '}
                  {number(session.fleet.failed + (session.green?.failed || 0))}{' '}
                  rejected
                </small>
              </div>
            </div>
            <details className="replicas-drawer">
              <summary>
                Replicas & accelerator ranks{' '}
                <span>
                  {summary.readyReplicas} ready / {summary.activeReplicas}{' '}
                  allocated
                </span>
              </summary>
              <FleetDeployment state={session.fleet} green={session.green} />
            </details>
          </>
        )}
        {screen === 'simulation' && (
          <div className="fleet-lower-grid journey-workload">
            <section className="panel workload-expanded">
              <div className="panel-heading">
                <div>
                  <h2>Shape the workload</h2>
                  <p>
                    Specify demand, request shape, and the service targets the
                    fleet must protect.
                  </p>
                </div>
                <Select
                  value={pattern}
                  disabled={disabled}
                  onValueChange={(v) => v && applyPattern(v)}
                >
                  <SelectTrigger aria-label="Traffic pattern">
                    <SelectValue>
                      {
                        {
                          mixed: 'Mixed interactive',
                          prefill: 'Long-context prefill',
                          code: 'Code generation',
                          prefix: 'Shared-prefix agents',
                          bursty: 'Bursty arrivals',
                        }[pattern]
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries({
                      mixed: 'Mixed interactive',
                      prefill: 'Long-context prefill',
                      code: 'Code generation',
                      prefix: 'Shared-prefix agents',
                      bursty: 'Bursty arrivals',
                    }).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SavedWorkloads
                profile={activeProfile}
                workload={workload}
                disabled={disabled}
                onLoad={(profile, workload) => {
                  invalidate();
                  setSession({
                    fleet: createFleetState(profile, workload),
                    green: null,
                    rollout: null,
                  });
                  setHistory([]);
                  setPlaying(true);
                  setMessage('Loaded your saved workload.');
                }}
              />
              <div className="fleet-workload-controls">
                <Control
                  title="Offered traffic"
                  value={workload.rps}
                  min={1}
                  max={300}
                  onChange={(v) => change('rps', v)}
                  format={(n) => `${n.toFixed(1)} req/s`}
                  description="Total demand before admission or throttling. Surging a model increases its absolute request rate."
                  disabled={disabled}
                />
                <Control
                  title="Input tokens / request"
                  value={workload.inputTokens}
                  min={100}
                  max={16000}
                  step={100}
                  onChange={(v) => change('inputTokens', v)}
                  description="More input adds prefill work. Reusable prefixes can reduce that work, not decoding."
                  disabled={disabled}
                />
                <Control
                  title="Output tokens / request"
                  value={workload.outputTokens}
                  min={32}
                  max={2000}
                  step={16}
                  onChange={(v) => change('outputTokens', v)}
                  description="Longer generations hold serving capacity longer and raise decode pressure."
                  disabled={disabled}
                />
                <Control
                  title="Reusable prefix fraction"
                  value={workload.sharedPrefix}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => change('sharedPrefix', v)}
                  format={fraction}
                  description="Potential input reuse. It only helps profiles with caching enabled; affinity improves modeled reuse."
                  disabled={disabled}
                />
                <Control
                  title="Burstiness"
                  value={workload.burstiness}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => change('burstiness', v)}
                  format={fraction}
                  description="Deterministic arrival variation around the offered rate. Higher values create larger peaks."
                  disabled={disabled}
                />
                <Control
                  title="Outstanding request budget"
                  value={workload.concurrency}
                  min={8}
                  max={1024}
                  step={8}
                  onChange={(v) => change('concurrency', v)}
                  description="Fleet-wide queue budget, divided by model demand and blue-green traffic share. Excess requests are rejected and counted."
                  disabled={disabled}
                />
              </div>
              <div className="model-mix">
                <div>
                  <strong>Demand by model</strong>
                  <p>
                    Weights are normalized into shares of the total request
                    rate.
                  </p>
                </div>
                {MODEL_IDS.map((m) => (
                  <div className="mix-control" key={m}>
                    <label htmlFor={`mix-${m}`}>
                      <i style={{ background: `var(--model-${m})` }} />
                      {MODELS[m].shortName}
                      <span>
                        {fraction(workload.mix[m] / sumMix)} ·{' '}
                        {((workload.rps * workload.mix[m]) / sumMix).toFixed(1)}{' '}
                        req/s
                      </span>
                    </label>
                    <input
                      id={`mix-${m}`}
                      type="number"
                      min={0}
                      max={100}
                      disabled={disabled}
                      value={Math.round(workload.mix[m] * 100)}
                      onChange={(e) => {
                        const value = Math.max(
                          0,
                          Math.min(100, Number(e.target.value) || 0),
                        );
                        const mix = { ...workload.mix, [m]: value / 100 };
                        if (MODEL_IDS.some((id) => mix[id] > 0))
                          change('mix', mix);
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="service-targets">
                <div>
                  <ShieldCheck size={18} />
                  <span>Service targets</span>
                </div>
                <label>
                  First token
                  <input
                    type="number"
                    aria-label="First token target in milliseconds"
                    value={workload.ttftTargetMs}
                    min={50}
                    max={10000}
                    step={50}
                    disabled={disabled}
                    onChange={(e) =>
                      change(
                        'ttftTargetMs',
                        Math.max(
                          50,
                          Math.min(10000, Number(e.target.value) || 50),
                        ),
                      )
                    }
                  />
                  ms
                </label>
                <label>
                  Token interval
                  <input
                    type="number"
                    aria-label="Token interval target in milliseconds"
                    value={workload.tokenTargetMs}
                    min={20}
                    max={300}
                    step={5}
                    disabled={disabled}
                    onChange={(e) =>
                      change(
                        'tokenTargetMs',
                        Math.max(
                          20,
                          Math.min(300, Number(e.target.value) || 20),
                        ),
                      )
                    }
                  />
                  ms
                </label>
              </div>
              {locked && (
                <p className="locked-note">
                  Workload and capacity controls are locked to the approved
                  experiment until the rollout completes or rolls back.
                </p>
              )}
            </section>
          </div>
        )}
        {screen === 'simulation' && (
          <details className="scenario-drawer">
            <summary>Load a repeatable demo scenario</summary>
            <DemoScenarios onLoad={loadScenario} disabled={disabled} />
          </details>
        )}
        {(screen === 'live' || screen === 'simulation') && !observedMode && (
          <section className="panel demand-history">
            <div className="panel-heading">
              <div>
                <h2>Demand over simulated time</h2>
                <p>
                  Per-model arrival rates · same seeded variation across
                  compared profiles
                </p>
              </div>
              <div className="history-legend">
                {MODEL_IDS.map((m) => (
                  <span key={m}>
                    <i style={{ background: `var(--model-${m})` }} />
                    {MODELS[m].shortName}
                  </span>
                ))}
              </div>
            </div>
            <svg
              viewBox="0 0 1100 150"
              aria-label="Model request rates over simulated time"
            >
              <title>Per-model incoming requests per second</title>
              {[30, 65, 100, 135].map((y) => (
                <line
                  key={y}
                  x1="30"
                  x2="1070"
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="4 5"
                />
              ))}
              {MODEL_IDS.map((m) => (
                <path
                  key={m}
                  fill="none"
                  stroke={`var(--model-${m})`}
                  strokeWidth="2"
                  d={history
                    .map(
                      (p, i) =>
                        `${i ? 'L' : 'M'}${30 + (i / Math.max(1, history.length - 1)) * 1040},${135 - (p[m] / Math.max(1, ...history.flatMap((p) => MODEL_IDS.map((id) => p[id])))) * 110}`,
                    )
                    .join(' ')}
                />
              ))}
              <text x="30" y="148" fill="var(--muted-foreground)" fontSize="11">
                T+{history[0]?.time || 0}s
              </text>
              <text
                x="1070"
                y="148"
                textAnchor="end"
                fill="var(--muted-foreground)"
                fontSize="11"
              >
                T+{history.at(-1)?.time || 0}s
              </text>
            </svg>
            {session.rollout && (
              <div className="pool-demand-history">
                <div>
                  <strong>Requests routed to each deployment</strong>
                  <span>Blue · current → Green · proposed</span>
                </div>
                <p>
                  Migration changes which pool receives requests; it does not
                  manufacture additional demand.
                </p>
                <svg
                  viewBox="0 0 1100 130"
                  aria-label="Blue and green request rates over simulated time"
                >
                  <title>
                    Actual simulated requests routed to blue and green pools
                  </title>
                  {(['blue', 'green'] as const).map((pool) => (
                    <path
                      key={pool}
                      fill="none"
                      stroke={
                        pool === 'blue'
                          ? 'light-dark(#2767b5,#7ca9ff)'
                          : 'light-dark(#207044,#68d6a5)'
                      }
                      strokeWidth="3"
                      d={history
                        .map(
                          (p, i) =>
                            `${i ? 'L' : 'M'}${30 + (i / Math.max(1, history.length - 1)) * 1040},${105 - (p[pool] / Math.max(1, ...history.map((h) => h.blue + h.green))) * 85}`,
                        )
                        .join(' ')}
                    />
                  ))}
                  <text
                    x="30"
                    y="125"
                    fill="var(--muted-foreground)"
                    fontSize="11"
                  >
                    T+{history[0]?.time || 0}s
                  </text>
                  <text
                    x="1070"
                    y="125"
                    textAnchor="end"
                    fill="var(--muted-foreground)"
                    fontSize="11"
                  >
                    T+{history.at(-1)?.time || 0}s
                  </text>
                </svg>
                <div className="pool-demand-values">
                  <span>
                    Blue: {(history.at(-1)?.blue || 0).toFixed(1)} req/s
                  </span>
                  <span>
                    Green: {(history.at(-1)?.green || 0).toFixed(1)} req/s
                  </span>
                </div>
              </div>
            )}
          </section>
        )}
        {!observedMode && (screen === 'live' || screen === 'simulation') && (
          <div className="demo-next-step">
            <div>
              <strong>{screen === 'simulation' ? 'Experiment with this workload' : 'Optimize this fleet'}</strong>
              <p>{screen === 'simulation' ? 'Adjust the controls below, then ask Astra to compare profiles against this demand.' : 'Ask Astra for deployment profiles, compare their impact, then approve a rollout.'}</p>
            </div>
            <Button disabled={disabled} onClick={() => { setScreen('optimization'); setTab('experiments'); }}>
              {screen === 'simulation' ? 'Open experimentation lab' : 'Explore Astra optimizations'} <ChevronRight size={16} />
            </Button>
          </div>
        )}
        {session.rollout && !observedMode && (
          <section className={`panel rollout-panel ${locked ? 'is-live' : ''}`}>
            <div className="panel-heading">
              <div>
                <div className="eyebrow">BLUE-GREEN DEPLOYMENT</div>
                <h2>
                  {PHASE_LABELS[session.rollout.phase]}{' '}
                  <span className="small-badge">
                    {session.rollout.elapsed}s simulated
                  </span>
                </h2>
              </div>
              {locked && (
                <Button variant="outline" onClick={abort}>
                  <RotateCcw /> Roll back to blue
                </Button>
              )}
            </div>
            <div className="rollout-steps">
              {PHASES.map((phase, i) => (
                <div
                  key={phase}
                  className={
                    session.rollout!.phase === phase
                      ? 'current'
                      : PHASES.indexOf(session.rollout!.phase) > i
                        ? 'done'
                        : ''
                  }
                >
                  <span>
                    {PHASES.indexOf(session.rollout!.phase) > i ? (
                      <Check size={13} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {PHASE_LABELS[phase]}
                </div>
              ))}
            </div>
            <div className="migration-panels">
              <div className="blue-deployment">
                <span>BLUE · {session.rollout.blue.name}</span>
                <strong>
                  {100 - session.rollout.greenTraffic}%{' '}
                  <small>new traffic</small>
                </strong>
                <p>
                  {currency(session.rollout.blueEvaluation.summary.hourlyCost)}
                  /hr while retained
                </p>
              </div>
              <div className="migration-bridge">
                <GitBranch />
                <div className="traffic-split">
                  <span
                    style={{ width: `${100 - session.rollout.greenTraffic}%` }}
                  />
                  <span style={{ width: `${session.rollout.greenTraffic}%` }} />
                </div>
                <small>
                  {session.rollout.phase === 'complete'
                    ? 'Blue released'
                    : session.rollout.phase === 'rolled-back'
                      ? 'Green released'
                      : 'Warm → verify → migrate → drain'}
                </small>
              </div>
              <div className="green-deployment">
                <span>GREEN · {session.rollout.green.name}</span>
                <strong>
                  {session.rollout.greenTraffic}% <small>new traffic</small>
                </strong>
                <p>
                  {currency(session.rollout.greenEvaluation.summary.hourlyCost)}
                  /hr steady state
                </p>
              </div>
            </div>
            <div className="rollout-evidence">
              <div>
                <span>Steady-state compute</span>
                <Delta
                  before={session.rollout.blueEvaluation.summary.hourlyCost}
                  after={session.rollout.greenEvaluation.summary.hourlyCost}
                />
              </div>
              <div>
                <span>Estimated first token</span>
                <Delta
                  before={session.rollout.blueEvaluation.summary.ttftMs}
                  after={session.rollout.greenEvaluation.summary.ttftMs}
                  unit="ms"
                />
              </div>
              <div>
                <span>Replay output throughput</span>
                <Delta
                  before={
                    session.rollout.blueEvaluation.summary.outputTokensPerSecond
                  }
                  after={
                    session.rollout.greenEvaluation.summary
                      .outputTokensPerSecond
                  }
                  unit=" tok/s"
                  lower={false}
                />
              </div>
              <div>
                <span>Blue + green overlap spend</span>
                <strong>{currency(session.rollout.overlapCost, 3)}</strong>
                <small>
                  {currency(session.rollout.surgeCost, 3)} incremental green
                  cost
                </small>
              </div>
            </div>
            {session.rollout.phase === 'complete' && screen !== 'simulation' && (
              <div className="demo-next-step">
                <div><strong>Green is now the active fleet</strong><p>Test the deployed profile with new traffic and request patterns.</p></div>
                <Button onClick={() => { setScreen('simulation'); setPlaying(true); }}>Simulate new demand <ChevronRight size={16} /></Button>
              </div>
            )}
            <div className="rollout-status" role="log">
              <ShieldCheck size={16} />
              <span>{session.rollout.events.at(-1)?.message}</span>
            </div>
          </section>
        )}
        {message && (
          <output className="notification">
            <Activity size={17} />
            <span>{message}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss message"
              onClick={() => setMessage('')}
            >
              <X />
            </Button>
          </output>
        )}
        {screen === 'optimization' && !observedMode && (
          <section className="panel sample-history-panel">
            <div className="panel-heading">
              <div><h2>Two days of sample traffic</h2><p>Synthetic production-style workload · 576 five-minute windows · September 5–7, 2026 UTC</p></div>
              <a href="/data/synthetic-fleet-48h.json" download>Download dataset</a>
            </div>
            <p>Choose a period to load its demand into the fleet. Run the replay, or ask Astra to analyze the full two-day history and recommend changes for this period.</p>
            <div className="sample-phase-actions">
              {SAMPLE_PHASES.map(phase => <Button key={phase} disabled={disabled} variant={samplePhase === phase ? 'secondary' : 'outline'} onClick={() => { setWorkload(sampleTraffic(phase).workload); setSamplePhase(phase); setPlaying(false); }}>{SAMPLE_LABELS[phase]}</Button>)}
            </div>
            {samplePhase && <output>Loaded: {SAMPLE_LABELS[samplePhase]} · {sampleTraffic(samplePhase).history.selectedHours} hours represented. The three profile estimates use the same 90-second replay; they are not measured cloud performance.</output>}
          </section>
        )}
        {screen === 'optimization' && (
          <AstraAnalysis
            profile={activeProfile}
            workload={workload}
            disabled={disabled}
            requireTelemetry={observedMode}
            samplePhase={observedMode ? null : samplePhase}
            onBusy={(value) => {
              setBusy(value);
              if (value) setPlaying(false);
            }}
            onResult={receiveAnalysis}
          />
        )}
        {screen === 'optimization' && (
          <section className="panel evidence-panel">
            <div className="panel-heading">
              <div>
                <h2>Optimization opportunities</h2>
                <p>
                  Replay profiles · baseline: {activeProfile.name} · {workload.rps.toFixed(1)}{' '}
                  req/s · {workload.inputTokens.toLocaleString()} input /{' '}
                  {workload.outputTokens.toLocaleString()} output tokens
                </p>
              </div>
              <Button disabled={disabled || observedMode} onClick={analyze}>
                {busy ? <LoaderCircle className="spin" /> : <FlaskConical />}
                {busy ? 'Evaluating profiles…' : 'Run Optimization'}
              </Button>
            </div>
            <div className="evidence-heading">
              <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                <TabsList className="evidence-tabs">
                  <TabsTrigger value="experiments">
                    Recommended profiles{' '}
                    <span className="count">
                      {evidence?.experiments.length || 0}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="configuration">
                    Active configuration
                  </TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="eyebrow">SIMULATED EVIDENCE</span>
            </div>
            {tab === 'experiments' &&
              (evidence ? (
                <>
                  <div className="experiment-note">
                    <FlaskConical size={15} />
                    <p>
                      Each profile sees identical 90s demand. Fixed prescribed
                      capacity must pass; no unlisted autoscaling is used to
                      qualify it.
                    </p>
                  </div>
                  <Table className="experiments-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prescribed deployment profile</TableHead>
                        <TableHead>Modeled compute</TableHead>
                        <TableHead>First token estimate</TableHead>
                        <TableHead>Output throughput</TableHead>
                        <TableHead>Verdict</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evidence.experiments.map((e) => (
                        <TableRow key={e.profile.id}>
                          <TableCell>
                            <Button
                              variant="link"
                              className="profile-name-action"
                              disabled={disabled}
                              onClick={() => inspect(e)}
                            >
                              {e.profile.name}
                            </Button>
                            <small>{e.reason}</small>
                          </TableCell>
                          <TableCell>
                            {currency(e.evaluation.summary.hourlyCost)}/hr
                          </TableCell>
                          <TableCell>
                            {number(e.evaluation.summary.ttftMs)}ms
                          </TableCell>
                          <TableCell>
                            {number(e.evaluation.summary.outputTokensPerSecond)}{' '}
                            tok/s
                          </TableCell>
                          <TableCell>
                            <span
                              className={`verdict ${e.evaluation.feasible ? 'passed' : 'rejected'}`}
                            >
                              {e.evaluation.feasible ? (
                                <Check size={13} />
                              ) : (
                                <X size={13} />
                              )}{' '}
                              {e.evaluation.feasible ? 'Passed' : 'Rejected'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              disabled={disabled}
                              onClick={() => inspect(e)}
                            >
                              Inspect <ChevronRight size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <div className="empty-experiments">
                  <FlaskConical size={24} />
                  <div>
                    <strong>Every recommendation needs evidence.</strong>
                    <p>
                      Click Run Optimization to compare replay profiles, then Inspect to see model placement,
                      configuration changes, and their expected effects.
                    </p>
                  </div>
                </div>
              ))}
            {tab === 'configuration' && (
              <>
                <div className="fleet-config-flags">
                  <span>
                    <strong>Profile</strong>
                    {activeProfile.name}
                  </span>
                  <span>
                    <strong>Prefix cache</strong>
                    {activeProfile.prefixCache ? 'Enabled' : 'Disabled'}
                  </span>
                  <span>
                    <strong>Cache affinity</strong>
                    {activeProfile.cacheAffinity ? 'Enabled' : 'Disabled'}
                  </span>
                  <span>
                    <strong>Batch concurrency</strong>
                    {activeProfile.batchConcurrency}
                  </span>
                  <span>
                    <strong>Scaling headroom</strong>
                    {fraction(activeProfile.headroom)}
                  </span>
                </div>
                <Table className="experiments-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead>Deployment placement</TableHead>
                      <TableHead>Chips per replica</TableHead>
                      <TableHead>Assumed residency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MODEL_IDS.map((m) => (
                      <TableRow key={m}>
                        <TableCell>
                          <span className="model-name">
                            <i style={{ background: `var(--model-${m})` }} />
                            {MODELS[m].name}
                          </span>
                        </TableCell>
                        <TableCell>
                          {deploymentLines(activeProfile, m)}
                        </TableCell>
                        <TableCell>{MODELS[m].requiredChips}</TableCell>
                        <TableCell>{number(MODELS[m].residentGB)} GB</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {tab === 'activity' && (
              <div className="audit-list">
                <p className="audit-note">
                  This session’s operator actions and rollout gates. Export to
                  retain the record.
                </p>
                {[
                  ...audit,
                  ...(session.rollout?.events.map((e) => ({
                    time: `T+${e.time}s`,
                    message: e.message,
                  })) || []),
                ].map((event, i) => (
                  <div className="audit-row" key={i}>
                    <span className="audit-dot" />
                    <div>
                      <p>{event.message}</p>
                    </div>
                    <time>
                      {event.time.startsWith('T+')
                        ? event.time
                        : new Date(event.time).toLocaleTimeString()}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {screen === 'optimization' && (
          <section className="panel agent-context">
            <div className="panel-heading">
              <div>
                <h2>Where the analysis runs</h2>
                <p>
                  {observedMode
                    ? 'Imported pod inventory cannot support performance recommendations by itself.'
                    : 'Astra analysis runs server-side through the OpenAI API. Replay gates validate its selected profiles.'}
                </p>
              </div>
            </div>
            <details>
              <summary>
                Production agent, data access, and deployment permissions
              </summary>
              <div className="agent-context-grid">
                <article>
                  <strong>Customer GKE / VPC</strong>
                  <p>
                    The read-only observer discovers declared serving groups. A
                    future analysis service runs beside customer telemetry and
                    uses Workload Identity with scoped access.
                  </p>
                </article>
                <article>
                  <strong>Evidence for recommendations</strong>
                  <p>
                    Serving latency histograms, queues, token rates, prefix
                    hits, router traces, accelerator memory/network metrics,
                    runtime TP/PP/EP settings and billing. Raw prompts are not
                    required.
                  </p>
                </article>
                <article>
                  <strong>AI reasoning and approval</strong>
                  <p>
                    Astra ranks configurations and explains replay evidence.
                    Deterministic capacity/SLO gates verify its proposal; a
                    separate authorized controller applies approved changes and
                    supports rollback.
                  </p>
                </article>
              </div>
              <a
                href="https://github.com/newtonjain/inference-autopilot/blob/main/docs/GCP.md"
                target="_blank"
                rel="noreferrer"
              >
                GCP integration and permission details ↗
              </a>
            </details>
          </section>
        )}
        <div hidden={!(screen === 'live' && observedMode)}>
          <GcpConnection />
        </div>
        <footer className="footer">
          <span>INFERENCE AUTOPILOT · EXPERIMENT BEFORE EXECUTION</span>
          <span>
            Fluid request model · 1s simulated ticks · no cloud provisioning
          </span>
        </footer>
      </main>
      <Dialog
        open={!!inspected}
        onOpenChange={(open) => {
          if (!open) {
            setInspected(null);
            setProposal(null);
          }
        }}
      >
        <DialogContent className="wide-dialog prescription-dialog">
          <DialogHeader>
            <div className="eyebrow">DEPLOYMENT PRESCRIPTION</div>
            <DialogTitle>{inspected?.profile.name}</DialogTitle>
            <DialogDescription>{inspected?.reason}</DialogDescription>
          </DialogHeader>
          {inspected && (
            <>
              <div
                className={`prescription-verdict ${proposal?.status === 'proposed' ? 'good' : 'bad'}`}
              >
                <ShieldCheck size={20} />
                <div>
                  <strong>
                    {proposal?.status === 'proposed'
                      ? 'Eligible for approval'
                      : 'Not eligible for deployment'}
                  </strong>
                  <p>
                    {proposal?.status === 'proposed'
                      ? 'The prescribed capacity passed the fixed workload replay.'
                      : proposal?.evidenceEvaluation.reasons.join(' ') ||
                        'Experiment is stale. Close this panel and run optimization again.'}
                  </p>
                </div>
              </div>
              {evidence && (
                <section className="profile-impact" aria-label="Expected impact against baseline">
                  <h3>Expected impact against baseline</h3>
                  <p>Same 90-second simulated workload · estimated steady state after rollout</p>
                  <div className="impact-pillars">
                    <div><span>Cost</span><strong>{currency(evidence.baseline.summary.hourlyCost)}/hr → {currency(inspected.evaluation.summary.hourlyCost)}/hr</strong><Delta before={evidence.baseline.summary.hourlyCost} after={inspected.evaluation.summary.hourlyCost} unit=" $/hr" /></div>
                    <div><span>Latency · first token</span><strong>{number(evidence.baseline.summary.ttftMs)}ms → {number(inspected.evaluation.summary.ttftMs)}ms</strong><Delta before={evidence.baseline.summary.ttftMs} after={inspected.evaluation.summary.ttftMs} unit="ms" /></div>
                    <div><span>Throughput</span><strong>{number(evidence.baseline.summary.outputTokensPerSecond)} → {number(inspected.evaluation.summary.outputTokensPerSecond)} tok/s</strong><Delta before={evidence.baseline.summary.outputTokensPerSecond} after={inspected.evaluation.summary.outputTokensPerSecond} unit=" tok/s" lower={false} /></div>
                  </div>
                </section>
              )}
              <ol className="prescription-list">
                {inspected.prescription.map((line, i) => (
                  <li key={line}>
                    <span>{i + 1}</span>
                    <p>{line}</p>
                  </li>
                ))}
              </ol>
              <div className="profile-rationale">
                <h3>Why this recommendation</h3>
                <p>{inspected.aiReason || inspected.reason}</p>
                <p>
                  Evaluated against {evidence?.workload.rps.toFixed(1)} req/s,{' '}
                  {evidence?.workload.inputTokens.toLocaleString()} input
                  tokens, {evidence?.workload.outputTokens.toLocaleString()}{' '}
                  output tokens, and{' '}
                  {Math.round((evidence?.workload.sharedPrefix || 0) * 100)}%
                  potential prefix reuse. The 90-second replay checks latency
                  targets, rejected requests, and completed work before
                  approval.
                </p>
                <small>
                  {inspected.aiReason
                    ? `Generated by ${evidence?.aiModel} using the configuration sweep.`
                    : 'Rule-based explanation from replay evidence.'}
                </small>
              </div>
              <details className="deployment-file">
                <summary>Inspect deployment profile file</summary>
                <p>
                  This JSON is the exact simulation profile being prescribed. It
                  is not an executable GKE manifest; a production adapter must
                  translate and validate it.
                </p>
                <pre>{JSON.stringify(inspected.profile, null, 2)}</pre>
                <Button
                  variant="outline"
                  onClick={() =>
                    exportJson(
                      `${inspected.profile.id}.json`,
                      inspected.profile,
                    )
                  }
                >
                  <Download size={14} />
                  Download profile JSON
                </Button>
              </details>
              {inspected.aiRisks?.length ? (
                <div className="profile-rationale">
                  <h3>Tradeoffs and risks</h3>
                  <ul>
                    {inspected.aiRisks.map((risk, i) => (
                      <li key={i}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <h3>Exactly what changes</h3>
              <Table className="prescription-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Current placement</TableHead>
                    <TableHead>Prescribed placement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MODEL_IDS.map((m) => (
                    <TableRow key={m}>
                      <TableCell>{MODELS[m].shortName}</TableCell>
                      <TableCell>{deploymentLines(activeProfile, m)}</TableCell>
                      <TableCell>
                        {deploymentLines(inspected.profile, m)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="setting-diffs">
                {(
                  [
                    { key: 'prefixCache', label: 'Prefix caching' },
                    { key: 'cacheAffinity', label: 'Cache-aware routing' },
                    { key: 'batchConcurrency', label: 'Batch concurrency' },
                    { key: 'headroom', label: 'Scaling headroom' },
                    { key: 'autoscale', label: 'Autoscaling after rollout' },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key}>
                    <span>{label}</span>
                    <strong>
                      {String(activeProfile[key])} <ArrowRight size={12} />{' '}
                      {String(inspected.profile[key])}
                    </strong>
                  </div>
                ))}
              </div>
              {evidence && (
                <div className="prescription-metrics">
                  <div>
                    <span>Modeled compute / hour</span>
                    <strong>
                      {currency(evidence.baseline.summary.hourlyCost)} →{' '}
                      {currency(inspected.evaluation.summary.hourlyCost)}
                    </strong>
                  </div>
                  <div>
                    <span>First token estimate</span>
                    <strong>
                      {number(evidence.baseline.summary.ttftMs)} →{' '}
                      {number(inspected.evaluation.summary.ttftMs)} ms
                    </strong>
                  </div>
                  <div>
                    <span>Output throughput</span>
                    <strong>
                      {number(evidence.baseline.summary.outputTokensPerSecond)}{' '}
                      →{' '}
                      {number(
                        inspected.evaluation.summary.outputTokensPerSecond,
                      )}{' '}
                      tok/s
                    </strong>
                  </div>
                </div>
              )}
              <div className="rollout-explanation">
                <GitBranch size={19} />
                <p>{ROLLOUT_CAPACITY_NOTE}</p>
              </div>
              <div className="dialog-actions">
                <Button
                  variant="outline"
                  onClick={() => {
                    log(`Rejected ${inspected.profile.name}.`);
                    setInspected(null);
                    setProposal(null);
                  }}
                >
                  Reject
                </Button>
                <Button
                  onClick={approve}
                  disabled={proposal?.status !== 'proposed'}
                >
                  <Check /> Approve blue-green rollout
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={assumptions} onOpenChange={setAssumptions}>
        <DialogContent className="wide-dialog fleet-assumptions">
          <DialogHeader>
            <DialogTitle>What this fleet assumes</DialogTitle>
            <DialogDescription>
              All service rates and costs are illustrative. No real models or
              accelerators are running.
            </DialogDescription>
          </DialogHeader>
          <div className="assumption-models">
            {MODEL_IDS.map((m) => (
              <div key={m}>
                <strong>{MODELS[m].name}</strong>
                <p>{MODELS[m].assumption}</p>
                <small>
                  {MODELS[m].requiredChips} chip(s) / replica ·{' '}
                  {MODELS[m].supportedHardware.join(', ')}
                </small>
              </div>
            ))}
          </div>
          <p>
            Qwen uses a provisional quantized profile. Kimi’s 2.8T total
            parameters require a large multi-device allocation even though only
            a subset is active. Memory fit alone does not verify runtime or
            interconnect support.
          </p>
          <p>
            GB200 and GB300 pools show GPU chips in illustrative serving groups,
            not Grace Superchips or an entire NVL72 rack. TPU v7 is a separate
            runtime; enabled placements are an allowlist for this simulation.
          </p>
          <p>
            Queues, admission and rates are a fluid approximation, so request
            counters can be fractional internally. First-token latency is
            estimated, not a measured percentile. Cache reuse is an aggregate
            assumption; actual token-prefix LRU experiments remain in the
            single-GPU lab.
          </p>
          <p>{ROLLOUT_CAPACITY_NOTE}</p>
          <div className="source-links">
            <a
              href="https://ai.google.dev/gemma/docs/core"
              target="_blank"
              rel="noreferrer"
            >
              Gemma specifications ↗
            </a>
            <a
              href="https://huggingface.co/Qwen/Qwen3.5-397B-A17B"
              target="_blank"
              rel="noreferrer"
            >
              Qwen model card ↗
            </a>
            <a
              href="https://github.com/MoonshotAI/Kimi-K3"
              target="_blank"
              rel="noreferrer"
            >
              Kimi K3 model card ↗
            </a>
            <a
              href="https://docs.cloud.google.com/tpu/docs/tpu7x"
              target="_blank"
              rel="noreferrer"
            >
              TPU v7 specifications ↗
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
