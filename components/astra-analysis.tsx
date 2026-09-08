'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { FleetProfile, WorkloadConfig } from '@/lib/fleet-engine';
import type { ConfigurationSweep } from '@/lib/config-sweep';
import type { AstraDecision } from '@/lib/astra-client';
export interface AnalysisResult {
  id: string;
  context: string;
  source: 'simulation' | 'observed-proxy';
  workload: WorkloadConfig;
  profile: FleetProfile;
  sweep: ConfigurationSweep;
  decision: AstraDecision | null;
  limitations: string[];
  telemetryId: string | null;
}
async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const data = (await r.json()) as AnalysisResult & {
    error?: string;
    configured: boolean;
    persistence: boolean;
    telemetry: { id: string; endTime: string } | null;
    analyses: {
      id: string;
      status: string;
      created_at: number;
      payload: AnalysisResult;
    }[];
  };
  if (!r.ok) throw Error(data.error || 'Request failed.');
  return data;
}
export default function AstraAnalysis({
  profile,
  workload,
  disabled,
  requireTelemetry = false,
  samplePhase,
  onBusy,
  onResult,
}: {
  profile: FleetProfile;
  workload: WorkloadConfig;
  disabled: boolean;
  requireTelemetry?: boolean;
  samplePhase?: string | null;
  onBusy: (value: boolean) => void;
  onResult: (value: AnalysisResult) => void;
}) {
  const [status, setStatus] = useState<{
      configured: boolean;
      persistence: boolean;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [telemetry, setTelemetry] = useState<{
      id: string;
      endTime: string;
    } | null>(null),
    [useTelemetry, setUseTelemetry] = useState(requireTelemetry),
    [watch, setWatch] = useState(false),
    [history, setHistory] = useState<
      {
        id: string;
        status: string;
        created_at: number;
        payload: AnalysisResult;
      }[]
    >([]),
    [last, setLast] = useState<AnalysisResult | null>(null);
  const [collector, setCollector] = useState<{
    token: string;
    endpoint: string;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null),
    running = useRef(false),
    lastWindow = useRef(''),
    lastCall = useRef(0),
    alive = useRef(true);
  const refs = useRef({ profile, workload, disabled, onBusy, onResult, samplePhase });
  useEffect(() => {
    refs.current = { profile, workload, disabled, onBusy, onResult, samplePhase };
  });
  useEffect(() => {
    alive.current = true;
    void api('/api/agent/status')
      .then(setStatus)
      .catch((e) => setError(e.message));
    void api('/api/analysis')
      .then((x) => setHistory(x.analyses))
      .catch(() => {});
    void api('/api/telemetry')
      .then((x) => setTelemetry(x.telemetry))
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, []);
  async function analyze(id?: string) {
    if (running.current || refs.current.disabled) return;
    running.current = true;
    setBusy(true);
    refs.current.onBusy(true);
    setError('');
    lastCall.current = Date.now();
    try {
      const result = (await api('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: refs.current.profile,
          workload: refs.current.workload,
          ...(refs.current.samplePhase ? { samplePhase: refs.current.samplePhase } : id ? { telemetryId: id } : {}),
        }),
      })) as AnalysisResult;
      if (alive.current) {
        setLast(result);
        refs.current.onResult(result);
        if (id) lastWindow.current = id;
        const records = await api('/api/analysis');
        setHistory(records.analyses);
      }
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        setWatch(false);
      }
    } finally {
      running.current = false;
      refs.current.onBusy(false);
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!watch || samplePhase) return;
    const timer = setInterval(() => {
      void api('/api/telemetry')
        .then((x) => {
          setTelemetry(x.telemetry);
          if (
            x.telemetry &&
            x.telemetry.id !== lastWindow.current &&
            Date.now() - lastCall.current >= 60000 &&
            !refs.current.disabled
          )
            void analyze(x.telemetry.id);
        })
        .catch((e) => {
          setError(e.message);
          setWatch(false);
        });
    }, 15000);
    return () => clearInterval(timer);
  }, [watch, samplePhase]);
  async function upload(f: File | undefined) {
    if (!f) return;
    setError('');
    try {
      if (f.size > 100000) throw Error('Telemetry file must be under 100 KB.');
      const raw = JSON.parse(await f.text());
      await api('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raw),
      });
      const latest = await api('/api/telemetry');
      setTelemetry(latest.telemetry);
      setUseTelemetry(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  }
  async function credential() {
    setError('');
    try {
      const r = await fetch('/api/telemetry/credentials', { method: 'POST' });
      const d = (await r.json()) as {
        error?: string;
        token: string;
        endpoint: string;
      };
      if (!r.ok) throw Error(d.error);
      setCollector(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel astra-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Sparkles size={18} />
            Astra deployment analyst
          </h2>
          <p>
            {status?.configured
              ? 'GPT-6 Astra · server-side OpenAI API · account-backed evidence'
              : status
                ? 'OpenAI API key is not configured on the server.'
                : 'Checking server configuration…'}
          </p>
        </div>
        <Button
          disabled={
            busy ||
            disabled ||
            !status?.configured ||
            (!samplePhase && (useTelemetry || requireTelemetry) && !telemetry)
          }
          onClick={() =>
            void analyze(
              useTelemetry || requireTelemetry ? telemetry?.id : undefined,
            )
          }
        >
          <Sparkles size={15} />
          {busy ? 'Astra is evaluating…' : samplePhase ? 'Analyze 48-hour sample with Astra' : 'Ask Astra to optimize'}
        </Button>
      </div>
      {!status && error && <p><Button variant="outline" onClick={() => window.location.assign('/signin-with-chatgpt?return_to=/')}>Sign in to enable saved analysis</Button></p>}
      {samplePhase && <p>Synthetic two-day history selected. Cloud telemetry watching is paused while analyzing this sample.</p>}
      <div className="astra-controls">
        <label>
          <input
            type="checkbox"
            checked={!samplePhase && (useTelemetry || requireTelemetry)}
            disabled={!!samplePhase || busy || watch || requireTelemetry || !telemetry}
            onChange={(e) => setUseTelemetry(e.target.checked)}
          />
          Use latest observed telemetry
        </label>
        <span>
          {telemetry
            ? `Window ending ${new Date(telemetry.endTime).toLocaleString()}`
            : 'No telemetry window saved'}
        </span>
        <input
          hidden
          type="file"
          accept=".json,application/json"
          ref={file}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          <Upload size={14} />
          Import metrics
        </Button>
        <label htmlFor="watch-telemetry">
          <Switch
            id="watch-telemetry"
            checked={watch}
            disabled={!!samplePhase || !status?.configured || busy || disabled || !telemetry}
            onCheckedChange={(v) => {
              setWatch(v);
              if (v) setUseTelemetry(true);
            }}
          />
          Watch new telemetry
        </label>
      </div>
      <p className="astra-note">
        Sweeps the supported placement/cache/batch grid, then asks Astra to rank
        passing candidates. Watching checks every 15 seconds while this screen
        is open and runs at most once a minute, capped at 20 analyses/hour. Each
        AI analysis uses the configured paid API key.
      </p>
      {error && (
        <p className="astra-error" role="alert">
          {error}
        </p>
      )}
      {last && (
        <div className="astra-summary">
          <strong>
            {last.decision?.summary ||
              'No configuration passed the replay gates; no model recommendation was requested.'}
          </strong>
          <p>{last.decision?.bottleneck}</p>
          <small>
            {last.sweep.evaluatedCount} configurations evaluated ·{' '}
            {last.sweep.feasibleCount} feasible ·{' '}
            {last.decision?.model || 'Replay only'}
          </small>
          {last.decision && (
            <details>
              <summary>Evidence limits and missing data</summary>
              <ul>
                {[...last.limitations, ...last.decision.dataGaps].map(
                  (x, i) => (
                    <li key={i}>{x}</li>
                  ),
                )}
              </ul>
            </details>
          )}
        </div>
      )}
      {history.length > 0 && (
        <details className="analysis-history">
          <summary>Saved analysis history</summary>
          {history.map((r) => (
            <div key={r.id}>
              <span>
                {new Date(r.created_at).toLocaleString()} · {r.status}
              </span>
              {r.status === 'complete' && (
                <Button
                  variant="ghost"
                  disabled={busy || disabled}
                  onClick={() => {
                    setLast(r.payload);
                    onResult(r.payload);
                  }}
                >
                  <RefreshCw size={13} />
                  Review evidence
                </Button>
              )}
            </div>
          ))}
        </details>
      )}
      <details className="analysis-history">
        <summary>Collector access for GCP</summary>
        <p>
          The private site also requires authenticated transport; an app token
          alone does not bypass its sign-in gate. Create a token limited to
          sending aggregate telemetry into your account. Rotating it invalidates
          the previous collector token.
        </p>
        <Button variant="outline" onClick={() => void credential()}>
          Create / rotate collector token
        </Button>
        {collector && (
          <div className="collector-secret">
            <label>
              Ingestion endpoint
              <input readOnly value={collector.endpoint} />
            </label>
            <label>
              One-time collector token
              <input readOnly type="password" value={collector.token} />
            </label>
            <Button
              variant="ghost"
              onClick={() =>
                void navigator.clipboard
                  .writeText(collector.token)
                  .catch(() =>
                    setError(
                      'Clipboard unavailable. Select and copy the token field.',
                    ),
                  )
              }
            >
              Copy token
            </Button>
            <small>
              Store in Kubernetes Secret AUTOPILOT_INGEST_TOKEN. Only the hash
              is stored by this app.
            </small>
          </div>
        )}
      </details>
      <a
        className="telemetry-guide"
        href="https://github.com/newtonjain/inference-autopilot/blob/main/docs/TELEMETRY.md"
        target="_blank"
        rel="noreferrer"
      >
        GCP metric export and authenticated ingestion setup ↗
      </a>
    </section>
  );
}
