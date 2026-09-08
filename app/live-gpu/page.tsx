'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import './live.css';

type Window = { observedAt: string; completedRps: number | null; outputTokensPerSecond: number | null; meanTtftSeconds: number | null; running: number | null; waiting: number | null; gpus?: { utilizationPercent: number; usedMemoryMiB: number; totalMemoryMiB: number }[] };
type Run = { profile: string; label: string; concurrency: number; requests: number; successful: number; failed: number; elapsedSeconds: number; completedRequestsPerSecond: number; meanLatencySeconds: number | null; p95LatencySeconds: number | null };
type Snapshot = { fetchedAt: string; hardware: string; hourlyUsd: number; model: string; activeProfile: string; live: { status: string; windows?: Window[] }; configurations: Record<string, { maxNumSeqs: number; maxNumBatchedTokens: number; prefixCaching: boolean } | null>; recommendation?: { text: string; observedAt: string; model: string; responseId: string } | null; runs: Run[] };
const number = (v: number | null | undefined, digits = 2) => v == null ? '—' : v.toFixed(digits);
const average = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;

function Line({ windows, field, label, suffix }: { windows: Window[]; field: 'completedRps' | 'outputTokensPerSecond' | 'meanTtftSeconds'; label: string; suffix: string }) {
  const vals = windows.map(w => w[field]);
  const max = Math.max(0.01, ...vals.filter((v): v is number => v != null));
  return <article className="gpu-chart"><span>{label}</span><strong>{number(vals.at(-1))} <small>{suffix}</small></strong>
    <svg viewBox="0 0 400 90" aria-label={`${label} across the latest measurement windows`}>
      {[20, 50, 80].map(y => <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="currentColor" opacity=".1" />)}
      {vals.map((v, i) => v != null && i > 0 && vals[i - 1] != null ? <line key={i} x1={(i - 1) * 400 / Math.max(1, vals.length - 1)} x2={i * 400 / Math.max(1, vals.length - 1)} y1={80 - vals[i - 1]! / max * 70} y2={80 - v / max * 70} stroke="var(--primary)" strokeWidth="3" /> : null)}
    </svg><small>Recent windows · gaps mean unavailable data</small></article>;
}

export default function LiveGpu() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [concurrency, setConcurrency] = useState(16);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const r = await fetch('/api/live-gpu', { cache: 'no-store' });
        if (!r.ok) throw Error('Live connection unavailable. Last received measurements are retained.');
        const d = await r.json() as Snapshot;
        if (active) { setData(d); setError(''); setNow(Date.now()); }
      } catch (e) { if (active) { setError(String(e)); setNow(Date.now()); } }
    };
    void update();
    const timer = setInterval(update, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const windows = data?.live.windows ?? [];
  const latest = windows.at(-1);
  const age = latest ? Math.max(0, (now - Date.parse(latest.observedAt)) / 1000) : Infinity;
  const fresh = !error && age < 35 && data?.live.status === 'live';
  const gpu = latest?.gpus?.[0];
  const runs = data?.runs ?? [];
  const comparable = runs.filter(r => r.requests === 80 && r.concurrency === concurrency);
  const stats = (profile: string) => {
    const list = comparable.filter(r => r.profile === profile);
    const rps = average(list.map(r => r.completedRequestsPerSecond));
    return { count: list.length, rps, mean: average(list.flatMap(r => r.meanLatencySeconds == null ? [] : [r.meanLatencySeconds])), p95: average(list.flatMap(r => r.p95LatencySeconds == null ? [] : [r.p95LatencySeconds])), failures: list.reduce((n, r) => n + r.failed, 0), cost: rps ? (data?.hourlyUsd ?? 1.99) / 3600 / rps * 1000 : null };
  };
  const base = stats('baseline'), candidate = stats('candidate');
  const delta = base.rps && candidate.rps ? (candidate.rps / base.rps - 1) * 100 : null;
  return <main className="gpu-page">
    <header className="gpu-header"><Link href="/">← Fleet laboratory</Link><span>REAL GPU · LAMBDA ARIZONA</span><a href="/api/live-gpu" target="_blank" rel="noreferrer">Evidence JSON ↗</a></header>
    <section className="gpu-title"><div><p>INFERENCE AUTOPILOT</p><h1>One chip. Measured performance.</h1><span>{data?.model ?? 'Gemma 4 26B-A4B IT · AWQ 4-bit'} · {data?.hardware ?? '1 × A100 40GB'}</span></div><div className={`gpu-status ${fresh ? 'fresh' : ''}`}>{fresh ? '● Live telemetry' : '○ Waiting / stale'}<small>{latest ? `${Math.round(age)}s since last observation` : 'Connecting to the GPU agent'}</small></div></section>
    {error && <output className="gpu-alert">{error}</output>}
    <section className="gpu-flow" aria-label="Measured request pipeline"><div><small>IN FLIGHT</small><strong>{number(latest?.running, 0)}</strong><span>running requests</span></div><b>→</b><div><small>WAITING</small><strong>{number(latest?.waiting, 0)}</strong><span>queued requests</span></div><b>→</b><div className="gpu-chip"><small>A100 · {data?.activeProfile ?? 'baseline'}</small><strong>{number(gpu?.utilizationPercent, 0)}%</strong><span>sampled GPU utilization</span></div><b>→</b><div><small>COMPLETED</small><strong>{number(latest?.completedRps)}</strong><span>requests / second</span></div></section>
    <p className="gpu-note">{number(gpu ? gpu.usedMemoryMiB / 1024 : null, 1)} / {number(gpu ? gpu.totalMemoryMiB / 1024 : null, 1)} GiB GPU memory · Polls every 10 seconds · Inference is real; benchmark prompts are synthetic.</p>
    <section className="gpu-charts"><Line windows={windows} field="completedRps" label="Completed throughput" suffix="req/s" /><Line windows={windows} field="meanTtftSeconds" label="Mean time to first token" suffix="seconds" /><Line windows={windows} field="outputTokensPerSecond" label="Output throughput" suffix="tokens/s" /></section>
    <section className="gpu-section"><div className="gpu-section-heading"><div><h2>Baseline → Astra candidate</h2><p>Same checkpoint, hardware and 80-request workload. Each request uses ~1,705 input tokens and up to 128 output tokens.</p></div><div className="gpu-controls" aria-label="Client concurrency">{[8, 16].map(c => <button key={c} aria-pressed={concurrency === c} onClick={() => setConcurrency(c)}>{c} concurrent</button>)}</div></div>
      <div className="gpu-table-wrap"><table><thead><tr><th>Measured metric</th><th>Baseline</th><th>Astra candidate</th></tr></thead><tbody>
        <tr><th>Completed throughput</th><td>{number(base.rps)} req/s</td><td>{number(candidate.rps)} req/s{delta != null && <small>{delta >= 0 ? '+' : ''}{number(delta, 1)}% vs baseline</small>}</td></tr>
        <tr><th>Mean request latency</th><td>{number(base.mean)} s</td><td>{number(candidate.mean)} s</td></tr>
        <tr><th>Mean of trial p95 latencies</th><td>{number(base.p95)} s</td><td>{number(candidate.p95)} s</td></tr>
        <tr><th>Compute cost / 1,000 completions</th><td>${number(base.cost, 3)}</td><td>${number(candidate.cost, 3)}</td></tr>
        <tr><th>VM rental</th><td>$1.99/hour</td><td>$1.99/hour</td></tr>
        <tr><th>Trials / failed requests</th><td>{base.count} / {base.failures}</td><td>{candidate.count} / {candidate.failures}</td></tr>
        <tr><th>Maximum running sequences</th><td>{data?.configurations.baseline?.maxNumSeqs ?? '—'}</td><td>{data?.configurations.candidate?.maxNumSeqs ?? '—'}</td></tr>
        <tr><th>Prefix caching</th><td>{data?.configurations.baseline?.prefixCaching ? 'On' : 'Off'}</td><td>{data?.configurations.candidate ? (data.configurations.candidate.prefixCaching ? 'On' : 'Off') : '—'}</td></tr>
      </tbody></table></div>
      <p className="gpu-note">Cost per 1,000 completions = hourly rental ÷ 3,600 ÷ measured requests/sec × 1,000. Assumes continuous equivalent load; excludes Astra, networking and idle time. The VM bill does not fall when utilization falls.</p>
      <p className="gpu-note">Short, closed-loop trials demonstrate tested throughput, not maximum sustainable capacity or a production SLO. No model-quality improvement is implied. The baseline deliberately disables prefix caching; it is not a claim about vLLM defaults.</p>
    </section>
    <section className="gpu-section"><h2>Astra’s observed recommendation</h2>{data?.recommendation ? <><p className="gpu-note">{data.recommendation.model} · {data.recommendation.observedAt} · Suggestions require measured validation.</p><pre className="gpu-recommendation">{data.recommendation.text}</pre></> : <p>Waiting for Astra’s first evidence-backed recommendation.</p>}</section>
    <section className="gpu-section"><h2>All measured runs</h2><div className="gpu-table-wrap"><table><thead><tr><th>Run</th><th>Concurrent</th><th>Pass / total</th><th>req/s</th><th>Mean latency</th><th>p95 latency</th></tr></thead><tbody>{runs.map(r => <tr key={r.label}><th>{r.label}</th><td>{r.concurrency}</td><td>{r.successful} / {r.requests}</td><td>{number(r.completedRequestsPerSecond)}</td><td>{number(r.meanLatencySeconds)} s</td><td>{number(r.p95LatencySeconds)} s</td></tr>)}</tbody></table></div></section>
    <footer className="gpu-note">Read-only live demo · Single A100 · Quantization held fixed across comparisons · Temporary telemetry tunnel; connection status is shown explicitly.</footer>
  </main>;
}
