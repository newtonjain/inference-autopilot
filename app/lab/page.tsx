'use client';
import Link from 'next/link';
import ThemeToggle from '@/components/theme-toggle';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cpu,
  FlaskConical,
  ArrowUpRight,
  Sparkles,
  ShieldCheck,
  Layers3,
  Network,
  ArrowRight,
  Activity,
  Download,
  Settings2,
  RotateCcw,
  Check,
  X,
  Zap,
  Upload,
  ChevronRight,
  CircleCheck,
  LoaderCircle,
  Clock3,
  FileJson,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
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
import {
  DEFAULT_SETTINGS,
  MODELS,
  baselineConfig,
  candidateConfigs,
  generateTrace,
  hash,
  rankCandidates,
  simulate,
  validateTrace,
} from '@/lib/simulator';
import type {
  Candidate,
  Config,
  Result,
  Scope,
  Settings,
  Trace,
  Workload,
} from '@/lib/simulator';
import { approveAndApply, propose } from '@/lib/workflow';
import type { Proposal } from '@/lib/workflow';

type Audit = { time: string; action: string; detail: string };
const WORKLOADS: Record<Workload, string> = {
  prefix: 'Repeated prefixes',
  mixed: 'Mixed interactive',
  code: 'Code generation',
  seasonal: 'Daily demand cycle',
};
const money = (v: number, digits = 2) => `$${v.toFixed(digits)}`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const waitFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Chart({
  baseline,
  comparison,
}: {
  baseline: Result;
  comparison?: Result;
}) {
  const width = 780,
    height = 180,
    pad = 28;
  const maxTime = Math.max(baseline.elapsed, comparison?.elapsed || 0);
  const line = (r: Result) =>
    r.series
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${pad + (p.time / maxTime) * (width - pad * 2)},${height - pad - (p.utilization / 100) * (height - pad * 2)}`,
      )
      .join(' ');
  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span>
          <i className="legend-dot base" />
          Current deployment
        </span>
        {comparison && (
          <span>
            <i className="legend-dot candidate" />
            Selected candidate
          </span>
        )}
        <small>Modeled busy time</small>
      </div>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        aria-label="Simulated GPU busy time over replay time"
      >
        <title>Simulated GPU busy time over replay time</title>
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bca1ff" stopOpacity=".13" />
            <stop offset="100%" stopColor="#bca1ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((n) => (
          <g key={n}>
            <line
              x1={pad}
              x2={width - pad}
              y1={height - pad - (n / 100) * (height - pad * 2)}
              y2={height - pad - (n / 100) * (height - pad * 2)}
              stroke="#2a2e3b"
              strokeDasharray="3 5"
            />
            <text
              x={pad - 6}
              y={height - pad - (n / 100) * (height - pad * 2) + 4}
              textAnchor="end"
              fill="#818a9c"
              fontSize="11"
            >
              {n}
            </text>
          </g>
        ))}
        <path
          d={`${line(baseline)} L${pad + ((baseline.series.at(-1)?.time || 0) / maxTime) * (width - pad * 2)},${height - pad} L${pad},${height - pad} Z`}
          fill="url(#chart-fill)"
        />
        <path d={line(baseline)} stroke="#b9a0ff" fill="none" strokeWidth="2" />
        {comparison && (
          <path
            d={line(comparison)}
            stroke="#83d9bc"
            fill="none"
            strokeWidth="2"
          />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text
            key={f}
            x={pad + f * (width - pad * 2)}
            y={height - 6}
            fill="#818a9c"
            fontSize="11"
            textAnchor="middle"
          >
            {Math.round(maxTime * f)}s
          </text>
        ))}
      </svg>
    </div>
  );
}
function Topology({ result, scope }: { result: Result; scope: Scope }) {
  return (
    <div className={`fleet-topology ${scope}`}>
      <div className="ingress">
        <Activity size={16} />
        <span>{result.count.toLocaleString()} requests</span>
        <span className="ingress-arrow">→</span>
        <span>
          {scope === 'fleet' ? 'Model-aware router' : 'Inference scheduler'}
        </span>
      </div>
      <div className="node-grid">
        {Array.from({ length: result.config.nodes }, (_, n) => (
          <div className="node-group" key={n}>
            <div className="node-label">
              <Layers3 size={13} />
              {scope === 'chip'
                ? 'INSTANCE 01'
                : `NODE ${String(n + 1).padStart(2, '0')}`}
              <span>
                {result.config.gpusPerNode} GPU
                {result.config.gpusPerNode > 1 ? 's' : ''}
              </span>
            </div>
            <div className="gpu-grid">
              {result.workers
                .filter((w) => w.node === n + 1)
                .map((w) => (
                  <div
                    className={`gpu-node ${w.model === 'gemma31' ? 'secondary-model' : ''}`}
                    key={w.id}
                  >
                    <div className="gpu-node-top">
                      <Cpu size={17} />
                      <span>{w.id.split('-')[1].toUpperCase()}</span>
                      <i />
                    </div>
                    <strong>
                      Gemma 4 <span>{MODELS[w.model].short}</span>
                    </strong>
                    <div className="memory-track">
                      <span
                        style={{ width: `${Math.min(100, w.utilization)}%` }}
                      />
                    </div>
                    <div className="gpu-node-foot">
                      <span>{pct(w.utilization)} busy</span>
                      <span>{w.requests} req.</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="topology-caption">
        <span>
          <i className="legend-dot base" />
          26B A4B · BF16
        </span>
        {scope === 'fleet' && (
          <span>
            <i className="legend-dot candidate" />
            31B Dense · BF16
          </span>
        )}
        <span>H100 80 GB / GPU</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [config, setConfig] = useState<Config>(baselineConfig('chip'));
  const [imported, setImported] = useState<Trace | null>(null);
  const [burst, setBurst] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [audit, setAudit] = useState<Audit[]>([]);
  const [restored, setRestored] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_SETTINGS);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [previous, setPrevious] = useState<Config | null>(null);
  const [before, setBefore] = useState<Result | null>(null);
  const [applied, setApplied] = useState(false);
  const [detailTab, setDetailTab] = useState('experiments');
  const uploadRef = useRef<HTMLInputElement>(null);
  const appliedIds = useRef(new Set<string>());
  const revision = useRef(0);
  const running = useRef(false);
  const trace = useMemo(
    () => imported || generateTrace(settings, burst),
    [settings, burst, imported],
  );
  const result = useMemo(
    () => simulate(trace, config, settings),
    [trace, config, settings],
  );
  const candidate = candidates.find((c) => c.config.id === selected);
  const compare = candidate?.result;
  const fingerprint = hash({ trace, config, settings });
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem('autopilot-audit-v1') || '[]',
        );
        if (Array.isArray(saved))
          setAudit(
            saved
              .filter(
                (v) =>
                  typeof v.time === 'string' &&
                  typeof v.action === 'string' &&
                  typeof v.detail === 'string',
              )
              .slice(0, 30),
          );
      } catch {}
      setRestored(true);
    });
  }, []);
  useEffect(() => {
    if (restored)
      try {
        localStorage.setItem(
          'autopilot-audit-v1',
          JSON.stringify(audit.slice(0, 30)),
        );
      } catch {}
  }, [audit, restored]);
  function log(action: string, detail: string) {
    setAudit((old) =>
      [{ time: new Date().toISOString(), action, detail }, ...old].slice(0, 30),
    );
  }
  function clearExperiment() {
    revision.current++;
    setCandidates([]);
    setSelected(null);
    setProposal(null);
    setApplied(false);
    setBefore(null);
    setPrevious(null);
    setMessage('');
  }
  function changeSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    clearExperiment();
    setSettings((s) => ({ ...s, [key]: value }));
    if (['workload', 'load', 'prefix', 'seed', 'duration'].includes(key))
      setImported(null);
  }
  function changeScope(scope: Scope) {
    clearExperiment();
    setSettings((s) => ({ ...s, scope }));
    setConfig(baselineConfig(scope));
    setImported(null);
    setBurst(false);
  }
  async function optimize() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setCandidates([]);
    setSelected(null);
    setMessage('');
    const rev = ++revision.current;
    const tested: Candidate[] = [];
    try {
      const options = candidateConfigs(config, settings.scope);
      for (let i = 0; i < options.length; i++) {
        setProgress(
          `Replaying profile ${i + 1} of ${options.length} · ${options[i].config.name}`,
        );
        await waitFrame();
        if (revision.current !== rev) return;
        const item = {
          ...options[i],
          result: simulate(trace, options[i].config, settings),
        };
        tested.push(item);
        setCandidates([...tested]);
      }
      const ranked = rankCandidates(tested);
      setCandidates(ranked);
      setSelected(ranked[0]?.config.id || null);
      setDetailTab('experiments');
      const passing = ranked.filter((c) => c.result.feasible).length;
      setMessage(
        `${tested.length} profiles evaluated on trace ${hash(trace)}. ${passing} passed all service targets.`,
      );
      log(
        'Experiments completed',
        `${settings.scope} · trace ${hash(trace)} · ${passing}/${tested.length} profiles passed`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Experiment failed.');
    } finally {
      running.current = false;
      setBusy(false);
      setProgress('');
    }
  }
  function review(c: Candidate) {
    try {
      setProposal(propose(c, trace, config, settings));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function apply() {
    if (!proposal) return;
    try {
      const verified = approveAndApply(
        proposal,
        trace,
        config,
        settings,
        appliedIds.current,
      );
      setPrevious(config);
      setBefore(result);
      setConfig(verified.config);
      setCandidates([]);
      setSelected(null);
      setApplied(true);
      setProposal(null);
      setMessage(
        'Approved configuration applied to the simulator and verified on the same trace.',
      );
      log(
        'Change approved and verified',
        `${config.name} → ${verified.config.name} · ${proposal.id} · ${verified.compliant}/${verified.count} within targets`,
      );
    } catch (e) {
      setMessage((e as Error).message);
      setProposal(null);
    }
  }
  function rollback() {
    if (!previous) return;
    const r = simulate(trace, previous, settings);
    setConfig(previous);
    setCandidates([]);
    setSelected(null);
    setApplied(false);
    setBefore(null);
    setPrevious(null);
    setMessage(
      `Previous configuration restored. ${r.feasible ? 'Verification passed.' : 'The current workload still breaches targets; more capacity or different settings are needed.'}`,
    );
    log(
      'Manual rollback',
      `Restored ${previous.name} · ${r.feasible ? 'targets passed' : 'targets still breached'}`,
    );
  }
  function injectBurst() {
    clearExperiment();
    const stressed = generateTrace(settings, true);
    setImported(null);
    setBurst(true);
    const tested = simulate(stressed, config, settings);
    if (previous && !tested.feasible) {
      const recovery = simulate(stressed, previous, settings);
      setConfig(previous);
      setMessage(
        `Burst breached targets. Restored ${previous.name}. ${recovery.feasible ? 'Recovery passed.' : 'Recovery still breaches targets; further action is required.'}`,
      );
      log(
        'Burst triggered rollback',
        `${tested.compliant}/${tested.count} met targets before rollback; ${recovery.compliant}/${recovery.count} after. Simulated warm restoration; no cloud restart.`,
      );
    } else {
      setMessage(
        tested.feasible
          ? 'The active configuration passed the 3.5× burst stress test.'
          : 'The 3.5× burst breached targets. Run optimization to evaluate alternatives.',
      );
      log(
        'Burst stress test',
        `${tested.compliant}/${tested.count} within targets · ${tested.feasible ? 'passed' : 'failed'}`,
      );
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 3_000_000)
        throw Error('Trace file must be smaller than 3 MB.');
      const readRevision = ++revision.current;
      const content = await file.text();
      if (readRevision !== revision.current)
        throw Error(
          'The workspace changed during import. Please import again.',
        );
      const parsed = validateTrace(JSON.parse(content));
      if (
        settings.scope !== 'fleet' &&
        parsed.requests.some((r) => r.model === 'gemma31')
      )
        throw Error(
          'Switch to Multi-model fleet to import a trace containing Gemma 4 31B.',
        );
      clearExperiment();
      setImported(parsed);
      setBurst(false);
      setMessage(
        `Imported ${parsed.requests.length} requests. The original trace is used unchanged in every experiment.`,
      );
      log(
        'Trace imported',
        `${file.name} · ${hash(parsed)} · ${parsed.requests.length} requests`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
    if (uploadRef.current) uploadRef.current.value = '';
  }
  function exportReport() {
    download(`autopilot-${settings.scope}-${hash(trace)}.json`, {
      version: 1,
      evidence: 'simulation',
      aiMode: 'deterministic-rules-no-live-AI',
      settings,
      trace,
      active: result,
      before,
      experiments: candidates,
      audit,
      assumptions: {
        residentGB: MODELS,
        kvGBPerToken: 0.0001220703125,
        perSequenceDecodeCeiling: 55,
        schedulerStepSeconds: 0.05,
        cacheBudgetFraction: 0.3,
        drainWindowSeconds: 60,
        pricing: 'Illustrative GPU-hour cost; whole node charged',
        rollout:
          'Instant simulator configuration replacement; no live canary or startup model',
      },
      source: 'https://ai.google.dev/gemma/docs/core/model_card_4',
    });
  }
  const actionRef = useRef({ optimize, result, busy, fingerprint });
  useEffect(() => {
    actionRef.current = { optimize, result, busy, fingerprint };
  });
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
    for (const tool of [
      {
        name: 'read_simulation_result',
        description:
          'Read active simulated deployment metrics and evidence identity.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw Error('Expected an empty object');
          return {
            evidence: 'simulation',
            context: actionRef.current.fingerprint,
            result: actionRef.current.result,
          };
        },
      },
      {
        name: 'run_simulation_experiments',
        description:
          'Evaluate candidate profiles for the current visible workload. Does not approve or apply changes.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw Error('Expected an empty object');
          if (running.current) throw Error('An experiment is already running');
          await actionRef.current.optimize();
          return { status: 'completed', evidence: 'simulation' };
        },
      },
    ]) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, []);
  const savings = compare
    ? ((result.hourlyCost - compare.hourlyCost) / result.hourlyCost) * 100
    : 0;
  const changeLabel = compare
    ? compare.p95ttft < result.p95ttft
      ? `${((1 - compare.p95ttft / Math.max(0.001, result.p95ttft)) * 100).toFixed(0)}% lower first-token latency`
      : 'Passes targets; no first-token improvement'
    : '';
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>{' '}
          inference<span>autopilot</span>
        </Link>
        <div className="environment">
          <span className="status-dot" /> Simulation workspace{' '}
          <span className="divider">/</span> gemma-lab
        </div>
        <span className="avatar">NJ</span>
        <ThemeToggle />
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">DEPLOYMENT INTELLIGENCE</div>
            <h1>
              Fleet laboratory<span className="title-dot">.</span>
            </h1>
            <p>Find the right configuration. Prove it before you apply it.</p>
          </div>
          <div className="heading-actions">
            <span className="sim-badge">
              <FlaskConical size={16} /> Simulation · no cloud resources
            </span>
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(settings);
                  setAssumptionsOpen(true);
                }}
                disabled={busy}
              >
                <Settings2 /> Assumptions
              </Button>
              <Button variant="outline" onClick={exportReport} disabled={busy}>
                <Download /> Export report
              </Button>
            </div>
          </div>
        </div>
        <Tabs
          value={settings.scope}
          onValueChange={(value) => changeScope(value as Scope)}
        >
          <TabsList className="scope-tabs">
            <TabsTrigger disabled={busy} value="chip">
              <Cpu /> Single GPU <span>01</span>
            </TabsTrigger>
            <TabsTrigger disabled={busy} value="node">
              <Layers3 /> Full node <span>02</span>
            </TabsTrigger>
            <TabsTrigger disabled={busy} value="fleet">
              <Network /> Multi-model fleet <span>03</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">
              <span className="eyebrow">MODELED COMPUTE</span>
              <Layers3 size={15} />
            </div>
            <strong>
              {money(result.hourlyCost)}
              <em>/hr</em>
            </strong>
            <p>
              {config.nodes} node{config.nodes > 1 ? 's' : ''} ·{' '}
              {config.nodes * config.gpusPerNode} × H100 80 GB
            </p>
          </div>
          <div className="metric">
            <div className="metric-label">
              <span className="eyebrow">FIRST TOKEN · P95</span>
              <Clock3 size={15} />
            </div>
            <strong
              className={
                result.p95ttft > settings.ttftSlo ? 'warning-text' : ''
              }
            >
              {result.p95ttft.toFixed(2)}
              <em>s</em>
            </strong>
            <p>Target ≤ {settings.ttftSlo.toFixed(1)}s · completed requests</p>
          </div>
          <div className="metric">
            <div className="metric-label">
              <span className="eyebrow">GPU BUSY TIME</span>
              <Activity size={15} />
            </div>
            <strong>
              {result.utilization.toFixed(1)}
              <em>%</em>
            </strong>
            <p>Modeled scheduler occupancy</p>
          </div>
          <div className="metric">
            <div className="metric-label">
              <span className="eyebrow">WITHIN SERVICE TARGETS</span>
              <ShieldCheck size={15} />
            </div>
            <strong
              className={result.feasible ? 'success-text' : 'warning-text'}
            >
              {pct((result.compliant / Math.max(1, result.count)) * 100)}
            </strong>
            <p>
              {result.compliant} / {result.count} requests · {result.failed}{' '}
              failed
            </p>
          </div>
        </div>
        <div className="main-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {settings.scope === 'chip'
                    ? 'One GPU. Every token counts.'
                    : settings.scope === 'node'
                      ? 'One node. Four independent replicas.'
                      : 'A fleet that respects model boundaries.'}
                </h2>
                <p>
                  {applied ? 'Approved configuration' : config.name} ·{' '}
                  {config.routing.replaceAll('-', ' ')}
                </p>
              </div>
              <span className={`small-badge ${applied ? 'passed' : ''}`}>
                {applied ? 'VERIFIED' : 'ACTIVE PROFILE'}
              </span>
            </div>
            <Topology result={result} scope={settings.scope} />
            <Chart baseline={result} comparison={compare} />
            <div className="panel-foot">
              <ShieldCheck size={16} />
              <span>
                Fixed model identity · {trace.duration}s offered traffic ·{' '}
                {Math.round(result.elapsed - trace.duration)}s drain
              </span>
              <span className="trace-id">#{hash(trace)}</span>
            </div>
          </section>
          <section className="panel opportunity">
            <div className="opportunity-top">
              <div className="opportunity-icon">
                <Sparkles size={22} />
              </div>
              <span className="small-badge">RULE-BASED ENGINE</span>
            </div>
            <div className="eyebrow">
              {candidate ? 'EXPERIMENT RESULT' : 'NEXT BEST MOVE'}
            </div>
            <h2>
              {busy
                ? 'Testing the alternatives.'
                : candidate
                  ? candidate.config.name
                  : applied
                    ? 'Change verified.'
                    : 'More from every GPU.'}
            </h2>
            <p>
              {busy
                ? progress
                : candidate
                  ? candidate.rationale
                  : applied
                    ? 'The approved profile has been replayed against the same workload. Stress it with a burst or restore the previous configuration.'
                    : 'Evaluate deployment profiles against your traffic. Only changes that meet the service targets can be approved.'}
            </p>
            {candidate && !busy ? (
              <>
                <div
                  className={`recommendation-stat ${candidate.result.feasible ? '' : 'failed-stat'}`}
                >
                  <strong>
                    {candidate.result.feasible
                      ? savings > 0
                        ? `${savings.toFixed(0)}%`
                        : `${candidate.result.p95ttft.toFixed(2)}s`
                      : 'Outside targets'}
                  </strong>
                  <span>
                    {candidate.result.feasible
                      ? savings > 0
                        ? 'lower modeled hourly compute'
                        : changeLabel
                      : candidate.result.reasons[0]}
                  </span>
                </div>
                <div className="comparison-mini">
                  <span>
                    Token interval · p95
                    <strong>{candidate.result.p95itl.toFixed(0)} ms</strong>
                  </span>
                  <span>
                    Input tokens reused
                    <strong>{pct(candidate.result.cacheHit)}</strong>
                  </span>
                  <span>
                    Requests within targets
                    <strong>
                      {candidate.result.compliant} / {candidate.result.count}
                    </strong>
                  </span>
                </div>
                <Button
                  className="primary-action"
                  disabled={!candidate.result.feasible}
                  onClick={() => review(candidate)}
                >
                  Review & approve <ArrowRight />
                </Button>
                <Button className="rerun" variant="ghost" onClick={optimize}>
                  <RotateCcw /> Rerun experiments
                </Button>
              </>
            ) : (
              <>
                <div className="check-line">
                  <ShieldCheck size={16} /> First token ≤ {settings.ttftSlo}s
                </div>
                <div className="check-line">
                  <ShieldCheck size={16} /> Token interval ≤ {settings.itlSlo}ms
                </div>
                <div className="check-line">
                  <FlaskConical size={16} /> Same trace for every profile
                </div>
                <Button
                  className="primary-action"
                  disabled={busy}
                  onClick={optimize}
                >
                  {busy ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Play size={16} />
                  )}{' '}
                  {busy ? 'Running experiments' : 'Run optimization'}
                  <ArrowRight />
                </Button>
                {previous && (
                  <Button
                    className="rerun"
                    variant="ghost"
                    onClick={rollback}
                    disabled={busy}
                  >
                    <RotateCcw /> Restore previous profile
                  </Button>
                )}
              </>
            )}
            <small>Computed locally · no live Astra or inference calls</small>
          </section>
        </div>
        {message && (
          <output className="notification">
            <Activity size={17} />
            <span>{message}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss notification"
              onClick={() => setMessage('')}
            >
              <X />
            </Button>
          </output>
        )}
        {before && applied && (
          <div className="verified-strip">
            <CircleCheck />
            <strong>Verified on identical traffic</strong>
            <span>
              {money(before.hourlyCost)}/hr → {money(result.hourlyCost)}/hr
            </span>
            <span>
              p95 first token {before.p95ttft.toFixed(2)}s →{' '}
              {result.p95ttft.toFixed(2)}s
            </span>
            <span>
              {result.compliant}/{result.count} within targets
            </span>
          </div>
        )}
        <section className="panel workload-panel">
          <div className="panel-heading">
            <div>
              <h2>Shape the workload</h2>
              <p>
                {imported
                  ? 'Imported trace · traffic controls replace the import'
                  : burst
                    ? 'Burst injected · 3.5× arrivals during the middle 30%'
                    : 'Seeded synthetic traffic · change one variable, rerun the experiment'}
              </p>
            </div>
            <Button
              variant={burst ? 'secondary' : 'outline'}
              disabled={busy}
              onClick={
                burst
                  ? () => {
                      clearExperiment();
                      setBurst(false);
                    }
                  : injectBurst
              }
            >
              <Zap size={16} />
              {burst ? 'Clear burst' : 'Inject burst'}
            </Button>
          </div>
          <div className="workload-controls">
            <div className="control">
              <label htmlFor="workload-select">Traffic pattern</label>
              <Select
                value={settings.workload}
                onValueChange={(v) =>
                  v && changeSetting('workload', v as Workload)
                }
                disabled={busy}
              >
                <SelectTrigger id="workload-select">
                  <SelectValue>{WORKLOADS[settings.workload]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WORKLOADS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="control">
              <div className="control-label">
                Traffic intensity <strong>{settings.load.toFixed(1)}×</strong>
              </div>
              <Slider
                aria-label="Traffic intensity"
                value={[settings.load]}
                min={0.2}
                max={3}
                step={0.1}
                disabled={busy}
                onValueChange={(v) =>
                  changeSetting('load', Array.isArray(v) ? v[0] : v)
                }
              />
              <small>
                0.2× quiet <span>3× saturated</span>
              </small>
            </div>
            <div className="control">
              <div className="control-label">
                Requests with a shared prefix{' '}
                <strong>{settings.prefix}%</strong>
              </div>
              <Slider
                aria-label="Shared prefix requests"
                value={[settings.prefix]}
                min={0}
                max={100}
                step={5}
                disabled={busy}
                onValueChange={(v) =>
                  changeSetting('prefix', Array.isArray(v) ? v[0] : v)
                }
              />
              <small>
                Unique prompts <span>High reuse</span>
              </small>
            </div>
            <div className="trace-tools">
              <div>
                <span className="eyebrow">TRACE SEED</span>
                <strong>{imported ? imported.seed : settings.seed}</strong>
                <Button
                  aria-label="Generate a new trace seed"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => changeSetting('seed', settings.seed + 1)}
                >
                  <RotateCcw />
                </Button>
              </div>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => download(`traffic-${hash(trace)}.json`, trace)}
              >
                <FileJson /> Save trace
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => uploadRef.current?.click()}
              >
                <Upload /> Import trace
              </Button>
              <input
                ref={uploadRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => importFile(e.target.files?.[0])}
              />
            </div>
          </div>
        </section>
        <section className="panel evidence-panel">
          <Tabs
            value={detailTab}
            onValueChange={(v) => setDetailTab(String(v))}
          >
            <div className="evidence-heading">
              <TabsList className="evidence-tabs">
                <TabsTrigger value="experiments">
                  Experiments <span className="count">{candidates.length}</span>
                </TabsTrigger>
                <TabsTrigger value="profile">Active configuration</TabsTrigger>
                <TabsTrigger value="audit">
                  Activity log <span className="count">{audit.length}</span>
                </TabsTrigger>
              </TabsList>
              <span className="eyebrow">SIMULATED EVIDENCE</span>
            </div>
          </Tabs>
          {detailTab === 'experiments' &&
            (candidates.length ? (
              <Table className="experiments-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Deployment profile</TableHead>
                    <TableHead>Compute / hr</TableHead>
                    <TableHead>TTFT · p95</TableHead>
                    <TableHead>Within targets</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow
                      key={c.config.id}
                      data-state={
                        selected === c.config.id ? 'selected' : undefined
                      }
                    >
                      <TableCell>
                        <strong>{c.config.name}</strong>
                        <small>
                          {c.config.nodes * c.config.gpusPerNode} GPUs ·{' '}
                          {c.config.concurrency} concurrent / GPU
                        </small>
                      </TableCell>
                      <TableCell>{money(c.result.hourlyCost)}</TableCell>
                      <TableCell>{c.result.p95ttft.toFixed(2)}s</TableCell>
                      <TableCell>
                        {pct(
                          (c.result.compliant / Math.max(1, c.result.count)) *
                            100,
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`verdict ${c.result.feasible ? 'passed' : 'rejected'}`}
                        >
                          {c.result.feasible ? (
                            <Check size={13} />
                          ) : (
                            <X size={13} />
                          )}{' '}
                          {c.result.feasible ? 'Passed' : 'Rejected'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setSelected(c.config.id)}
                          aria-label={`Inspect ${c.config.name}`}
                        >
                          Inspect <ChevronRight size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="empty-experiments">
                <FlaskConical size={24} />
                <div>
                  <strong>Your evidence starts with an experiment.</strong>
                  <p>
                    Run optimization to compare candidate profiles on{' '}
                    {trace.requests.length} identical requests.
                  </p>
                </div>
              </div>
            ))}
          {detailTab === 'profile' && (
            <div className="profile-details">
              {[
                [
                  'Model',
                  settings.scope === 'fleet'
                    ? 'Gemma 4 26B A4B + 31B'
                    : 'Gemma 4 26B A4B',
                ],
                ['Precision', 'BF16 · fixed'],
                ['Prefix caching', config.cache ? 'Enabled' : 'Disabled'],
                ['Routing', config.routing],
                ['Concurrency', `${config.concurrency} / GPU`],
                ['Batch token cap', config.batchTokens.toLocaleString()],
                [
                  'Prefill share',
                  `${config.prefillShare * 100}% when decoding`,
                ],
                [
                  'Memory allocation',
                  `${config.memoryFraction * 100}% of 80 GB`,
                ],
                ['Input reused', pct(result.cacheHit)],
                ['Token interval · p95', `${result.p95itl.toFixed(1)} ms`],
                [
                  'Completed throughput',
                  `${result.throughput.toFixed(1)} tokens/s`,
                ],
                [
                  'Cost / 1M compliant output tokens',
                  result.costPerMillion === null
                    ? 'No compliant output'
                    : money(result.costPerMillion),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
          {detailTab === 'audit' && (
            <div className="audit-list">
              <p className="audit-note">
                Stored in this browser. Configuration and experiment state reset
                on refresh.
              </p>
              {audit.length ? (
                audit.map((entry, index) => (
                  <div className="audit-row" key={`${entry.time}-${index}`}>
                    <span className="audit-dot" />
                    <div>
                      <strong>{entry.action}</strong>
                      <p>{entry.detail}</p>
                    </div>
                    <time>
                      {new Date(entry.time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                ))
              ) : (
                <p className="empty-note">
                  Run an experiment to start the activity log.
                </p>
              )}
            </div>
          )}
        </section>
        <div className="evidence-banner">
          <FlaskConical size={18} />
          <p>
            <strong>Simulation, with the assumptions in view.</strong>{' '}
            Performance and costs are illustrative, not hardware benchmarks.
            Model specifications are sourced from Google.
          </p>
          <a
            href="https://ai.google.dev/gemma/docs/core/model_card_4"
            target="_blank"
            rel="noreferrer"
            aria-label="Read the Gemma 4 model card"
          >
            <ArrowUpRight size={20} />
          </a>
        </div>
        <footer className="footer">
          <span>
            INFERENCE AUTOPILOT <i /> EXPERIMENT BEFORE EXECUTION
          </span>
          <span>Engine v1 · 50 ms simulation steps</span>
        </footer>
      </main>
      <Dialog open={assumptionsOpen} onOpenChange={setAssumptionsOpen}>
        <DialogContent className="wide-dialog">
          <DialogHeader>
            <DialogTitle>Simulation assumptions</DialogTitle>
            <DialogDescription>
              These inputs are illustrative. Changing them invalidates existing
              experiments. No GPU is provisioned.
            </DialogDescription>
          </DialogHeader>
          <div className="assumption-facts">
            <Cpu size={21} />
            <div>
              <strong>Gemma 4 26B A4B · H100 80 GB</strong>
              <p>
                25.2B total / 3.8B active parameters. BF16 resident allocation
                assumed at 56 GB; 31B at 64 GB. Both include a runtime
                allowance.
              </p>
            </div>
          </div>
          <div className="assumption-inputs">
            {(
              [
                {
                  key: 'prefillRate',
                  label: 'Peak prefill tokens / second',
                  min: 1000,
                  max: 30000,
                  step: 500,
                },
                {
                  key: 'decodeRate',
                  label: 'Aggregate decode tokens / second',
                  min: 100,
                  max: 3000,
                  step: 50,
                },
                {
                  key: 'price',
                  label: 'Assumed price / GPU-hour ($)',
                  min: 0.1,
                  max: 30,
                  step: 0.1,
                },
                {
                  key: 'ttftSlo',
                  label: 'First-token p95 target (seconds)',
                  min: 0.2,
                  max: 30,
                  step: 0.1,
                },
                {
                  key: 'itlSlo',
                  label: 'Token-interval p95 target (ms)',
                  min: 20,
                  max: 500,
                  step: 5,
                },
                {
                  key: 'duration',
                  label: 'Offered traffic duration (seconds)',
                  min: 30,
                  max: 300,
                  step: 30,
                },
              ] as const
            ).map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft((s) => ({ ...s, [f.key]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="assumption-notes">
            <p>
              55 tokens/s per-sequence ceiling · synthetic KV cost 0.125
              MiB/token · LRU prefix cache capped at 30% of KV memory · 60s
              drain window.
            </p>
            <p>
              All replicas start warm with empty caches. Profile application and
              restoration are instantaneous simulator operations. No live
              canary, model startup, network transfer, or cross-GPU collectives
              are modeled.
            </p>
            <p>
              Token interval is a per-request average, summarized at p95. GPU
              busy time is scheduler occupancy, not measured SM utilization. A
              full node is charged even if a replica is idle.
            </p>
          </div>
          <Button
            className="primary-action"
            onClick={() => {
              const ranges: [keyof Settings, number, number][] = [
                ['prefillRate', 1000, 30000],
                ['decodeRate', 100, 3000],
                ['price', 0.1, 30],
                ['ttftSlo', 0.2, 30],
                ['itlSlo', 20, 500],
                ['duration', 30, 300],
              ];
              if (
                ranges.some(
                  ([key, min, max]) =>
                    !Number.isFinite(draft[key]) ||
                    Number(draft[key]) < min ||
                    Number(draft[key]) > max,
                )
              ) {
                setMessage(
                  'Assumptions must stay within the displayed ranges.',
                );
                return;
              }
              clearExperiment();
              setSettings(draft);
              if (draft.duration !== settings.duration) setImported(null);
              setAssumptionsOpen(false);
              log(
                'Assumptions updated',
                `Prefill ${draft.prefillRate} tok/s · decode ${draft.decodeRate} tok/s · ${money(draft.price)}/GPU-hour`,
              );
            }}
          >
            Apply assumptions <ArrowRight />
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!proposal}
        onOpenChange={(open) => !open && setProposal(null)}
      >
        <DialogContent className="wide-dialog">
          <DialogHeader>
            <DialogTitle>Approve this simulated change?</DialogTitle>
            <DialogDescription>
              Approval applies only to this configuration and traffic trace. It
              cannot change cloud infrastructure.
            </DialogDescription>
          </DialogHeader>
          {proposal && (
            <>
              <div className="approval-summary">
                <ShieldCheck />
                <div>
                  <strong>{proposal.candidate.config.name}</strong>
                  <p>
                    All service targets passed · trace #
                    {proposal.candidate.result.traceHash}
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Setting</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Proposed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      'nodes',
                      'gpusPerNode',
                      'concurrency',
                      'batchTokens',
                      'prefillShare',
                      'cache',
                      'routing',
                    ] as const
                  )
                    .filter(
                      (key) => config[key] !== proposal.candidate.config[key],
                    )
                    .map((key) => (
                      <TableRow key={key}>
                        <TableCell>
                          {
                            {
                              nodes: 'Nodes',
                              gpusPerNode: 'GPUs / node',
                              concurrency: 'Concurrency / GPU',
                              batchTokens: 'Batch token cap',
                              prefillShare: 'Prefill time share',
                              cache: 'Prefix caching',
                              routing: 'Routing',
                            }[key]
                          }
                        </TableCell>
                        <TableCell>{String(config[key])}</TableCell>
                        <TableCell className="success-text">
                          {String(proposal.candidate.config[key])}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <p className="approval-note">
                The model and precision stay fixed. We will replay the approved
                profile, verify the targets again, and retain the previous
                configuration for rollback.
              </p>
              <div className="dialog-actions">
                <Button
                  variant="outline"
                  onClick={() => {
                    log(
                      'Proposal rejected',
                      `${proposal.candidate.config.name} · ${proposal.id}`,
                    );
                    setProposal(null);
                  }}
                >
                  Reject change
                </Button>
                <Button onClick={apply}>
                  <Check /> Approve & apply
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
