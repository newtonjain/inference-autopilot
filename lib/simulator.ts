/** Deterministic, synthetic inference simulation. No measured hardware rates. */
export type Scope = 'chip' | 'node' | 'fleet';
export type Workload = 'prefix' | 'mixed' | 'code' | 'seasonal';
export type ModelId = 'gemma26' | 'gemma31';
export const MODELS = {
  gemma26: {
    name: 'Gemma 4 26B A4B',
    short: '26B A4B',
    residentGB: 56,
    speed: 1,
  },
  gemma31: {
    name: 'Gemma 4 31B',
    short: '31B Dense',
    residentGB: 64,
    speed: 0.72,
  },
};
export interface Settings {
  scope: Scope;
  workload: Workload;
  load: number;
  prefix: number;
  seed: number;
  ttftSlo: number;
  itlSlo: number;
  duration: number;
  prefillRate: number;
  decodeRate: number;
  price: number;
}
export const DEFAULT_SETTINGS: Settings = {
  scope: 'chip',
  workload: 'prefix',
  load: 1,
  prefix: 75,
  seed: 42,
  ttftSlo: 2,
  itlSlo: 90,
  duration: 120,
  prefillRate: 6500,
  decodeRate: 850,
  price: 3,
};
export interface Config {
  id: string;
  name: string;
  nodes: number;
  gpusPerNode: number;
  concurrency: number;
  batchTokens: number;
  prefillShare: number;
  cache: boolean;
  routing: 'round-robin' | 'least-queue' | 'prefix-affinity';
  memoryFraction: number;
}
export interface Request {
  id: number;
  arrival: number;
  model: ModelId;
  tenant: string;
  prefix: string | null;
  prefixTokens: number;
  input: number;
  output: number;
}
export interface Trace {
  version: 1;
  seed: number;
  duration: number;
  requests: Request[];
}
export interface WorkerResult {
  id: string;
  node: number;
  model: ModelId;
  utilization: number;
  requests: number;
  cachedTokens: number;
  peakMemoryGB: number;
}
export interface Point {
  time: number;
  arrivals: number;
  completed: number;
  utilization: number;
  queue: number;
}
export interface Result {
  config: Config;
  traceHash: string;
  count: number;
  completed: number;
  failed: number;
  compliant: number;
  p95ttft: number;
  p95itl: number;
  p95e2e: number;
  cacheHit: number;
  utilization: number;
  outputTokens: number;
  throughput: number;
  cost: number;
  hourlyCost: number;
  costPerMillion: number | null;
  elapsed: number;
  feasible: boolean;
  reasons: string[];
  workers: WorkerResult[];
  series: Point[];
}
export interface Candidate {
  config: Config;
  result: Result;
  rationale: string;
}
export function baselineConfig(scope: Scope): Config {
  return {
    id: `${scope}-baseline`,
    name: 'Current deployment',
    nodes: scope === 'fleet' ? 3 : 1,
    gpusPerNode: scope === 'chip' ? 1 : scope === 'node' ? 4 : 2,
    concurrency: 8,
    batchTokens: 4096,
    prefillShare: 0.65,
    cache: true,
    routing: 'round-robin',
    memoryFraction: 0.9,
  };
}
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateTrace(s: Settings, burst = false): Trace {
  const random = seeded(s.seed);
  const requests: Request[] = [];
  let time = 0;
  const gpus = s.scope === 'chip' ? 1 : s.scope === 'node' ? 4 : 6;
  while (time < s.duration) {
    const phase = time / s.duration;
    let rate = 0.85 * gpus * s.load;
    if (s.workload === 'seasonal')
      rate *= 0.35 + 0.8 * Math.pow(Math.sin(phase * Math.PI), 2);
    if (burst && phase > 0.35 && phase < 0.65) rate *= 3.5;
    time += -Math.log(Math.max(0.000001, 1 - random())) / rate;
    if (time >= s.duration) break;
    const shared = random() < s.prefix / 100;
    const prefix = shared ? `prefix-${Math.floor(random() * 8)}` : null;
    const tenant = `team-${Math.floor(random() * 2)}`;
    const long =
      s.workload === 'prefix' || (s.workload === 'mixed' && random() < 0.4);
    const input = Math.floor(
      (long ? 2000 : 400) + random() * (long ? 1500 : 900),
    );
    const output = Math.floor(
      (s.workload === 'code' ? 400 : 75) +
        random() * (s.workload === 'code' ? 450 : 180),
    );
    requests.push({
      id: requests.length,
      arrival: time,
      model: s.scope === 'fleet' && random() < 0.3 ? 'gemma31' : 'gemma26',
      tenant,
      prefix,
      prefixTokens: prefix ? Math.min(input, 1600) : 0,
      input,
      output,
    });
    if (requests.length > 5000) break;
  }
  return { version: 1, seed: s.seed, duration: s.duration, requests };
}
export function hash(value: unknown) {
  const str = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++)
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function validateTrace(value: unknown): Trace {
  if (!value || typeof value !== 'object')
    throw Error('Expected a JSON trace object.');
  const v = value as Trace;
  if (
    v.version !== 1 ||
    !Number.isFinite(v.duration) ||
    v.duration < 10 ||
    v.duration > 600 ||
    !Number.isInteger(v.seed) ||
    !Array.isArray(v.requests) ||
    v.requests.length < 1 ||
    v.requests.length > 5000
  )
    throw Error(
      'Trace needs version 1, a seed, a 10–600 second duration, and 1–5,000 requests.',
    );
  let previous = -1;
  const ids = new Set();
  for (const r of v.requests) {
    if (
      !r ||
      !Number.isInteger(r.id) ||
      ids.has(r.id) ||
      !Number.isFinite(r.arrival) ||
      r.arrival < previous ||
      r.arrival < 0 ||
      r.arrival >= v.duration ||
      !['gemma26', 'gemma31'].includes(r.model) ||
      typeof r.tenant !== 'string' ||
      r.tenant.length > 100 ||
      (r.prefix !== null &&
        (typeof r.prefix !== 'string' || r.prefix.length > 100)) ||
      ![r.input, r.output, r.prefixTokens].every(Number.isInteger) ||
      r.input < 1 ||
      r.input > 16000 ||
      r.output < 1 ||
      r.output > 4096 ||
      r.prefixTokens < 0 ||
      r.prefixTokens > r.input ||
      (r.prefix === null && r.prefixTokens !== 0)
    )
      throw Error(
        'Invalid request: check unique IDs, sorted arrivals, model, token limits, tenant, and prefix.',
      );
    ids.add(r.id);
    previous = r.arrival;
  }
  return v;
}
interface Job {
  request: Request;
  remainingPrefill: number;
  remainingOutput: number;
  first: number | null;
  finish: number | null;
  admitted: number;
  cached: number;
  kv: number;
  failed: boolean;
}
interface Worker {
  id: string;
  node: number;
  model: ModelId;
  queue: Request[];
  active: Job[];
  cache: Map<string, number>;
  cacheTokens: number;
  kv: number;
  busy: number;
  cached: number;
  requests: number;
  peak: number;
  budget: number;
}
const KV_GB_PER_TOKEN = 0.0001220703125; // synthetic 0.125 MiB/token, not derived Gemma KV layout
const STEP = 0.05;
function cacheKey(r: Request) {
  return JSON.stringify([r.model, r.tenant, r.prefix]);
}
function percentile(values: number[], fraction = 0.95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
function invalidConfig(c: Config) {
  return (
    !Number.isInteger(c.nodes) ||
    c.nodes < 1 ||
    c.nodes > 4 ||
    !Number.isInteger(c.gpusPerNode) ||
    c.gpusPerNode < 1 ||
    c.gpusPerNode > 4 ||
    !Number.isInteger(c.concurrency) ||
    c.concurrency < 1 ||
    c.concurrency > 64 ||
    !Number.isFinite(c.batchTokens) ||
    c.batchTokens < 128 ||
    c.batchTokens > 8192 ||
    !Number.isFinite(c.prefillShare) ||
    c.prefillShare <= 0 ||
    c.prefillShare >= 1 ||
    !Number.isFinite(c.memoryFraction) ||
    c.memoryFraction < 0.7 ||
    c.memoryFraction > 0.95 ||
    !['round-robin', 'least-queue', 'prefix-affinity'].includes(c.routing)
  );
}
export function simulate(trace: Trace, c: Config, s: Settings): Result {
  if (invalidConfig(c))
    throw Error('Configuration outside supported simulation bounds.');
  const workers: Worker[] = [];
  for (let n = 0; n < c.nodes; n++)
    for (let g = 0; g < c.gpusPerNode; g++) {
      const model: ModelId =
        s.scope === 'fleet' && g % 2 === 1 ? 'gemma31' : 'gemma26';
      workers.push({
        id: `n${n + 1}-gpu${g + 1}`,
        node: n + 1,
        model,
        queue: [],
        active: [],
        cache: new Map(),
        cacheTokens: 0,
        kv: 0,
        busy: 0,
        cached: 0,
        requests: 0,
        peak: MODELS[model].residentGB,
        budget: 80 * c.memoryFraction - MODELS[model].residentGB,
      });
    }
  const done: Job[] = [];
  const series: Point[] = [];
  let next = 0,
    rr = 0,
    t = 0,
    lastSample = 0,
    lastArrivals = 0,
    lastComplete = 0,
    lastBusy = 0;
  function evict(w: Worker, needed: number) {
    while (
      w.cache.size &&
      (w.cacheTokens * KV_GB_PER_TOKEN + w.kv + needed > w.budget ||
        w.cacheTokens * KV_GB_PER_TOKEN > w.budget * 0.3)
    ) {
      const key = w.cache.keys().next().value!;
      w.cacheTokens -= w.cache.get(key)!;
      w.cache.delete(key);
    }
  }
  for (t = 0; t < trace.duration + 60; t += STEP) {
    while (next < trace.requests.length && trace.requests[next].arrival <= t) {
      const r = trace.requests[next++];
      const pool = workers.filter((w) => w.model === r.model);
      if (!pool.length) {
        done.push({
          request: r,
          remainingPrefill: r.input,
          remainingOutput: r.output,
          first: null,
          finish: null,
          admitted: t,
          cached: 0,
          kv: 0,
          failed: true,
        });
        continue;
      }
      let w = pool[rr++ % pool.length];
      if (c.routing !== 'round-robin') {
        const score = (x: Worker) =>
          x.queue.length +
          x.active.length -
          (c.routing === 'prefix-affinity' &&
          r.prefix &&
          x.cache.has(cacheKey(r))
            ? 0.9
            : 0);
        w = pool.reduce((a, b) => (score(a) <= score(b) ? a : b));
      }
      w.queue.push(r);
      w.requests++;
    }
    for (const w of workers) {
      while (w.queue.length && w.active.length < c.concurrency) {
        const r = w.queue[0];
        const reservation = (r.input + r.output) * KV_GB_PER_TOKEN;
        if (reservation > w.budget) {
          w.queue.shift();
          done.push({
            request: r,
            remainingPrefill: r.input,
            remainingOutput: r.output,
            first: null,
            finish: null,
            admitted: t,
            cached: 0,
            kv: 0,
            failed: true,
          });
          continue;
        }
        if (w.kv + reservation > w.budget) break;
        evict(w, reservation);
        const key = cacheKey(r);
        const cached =
          c.cache && r.prefix
            ? Math.min(r.prefixTokens, w.cache.get(key) || 0)
            : 0;
        if (cached) {
          const original = w.cache.get(key)!;
          w.cache.delete(key);
          w.cache.set(key, original);
        }
        w.queue.shift();
        w.kv += reservation;
        w.peak = Math.max(
          w.peak,
          MODELS[w.model].residentGB + w.kv + w.cacheTokens * KV_GB_PER_TOKEN,
        );
        w.cached += cached;
        w.active.push({
          request: r,
          remainingPrefill: r.input - cached,
          remainingOutput: r.output,
          first: null,
          finish: null,
          admitted: t,
          cached,
          kv: reservation,
          failed: false,
        });
      }
      if (w.active.length) {
        const prefills = w.active.filter((j) => j.remainingPrefill > 0),
          decodes = w.active.filter((j) => j.remainingPrefill <= 0);
        const prefillShare = prefills.length
          ? decodes.length
            ? c.prefillShare
            : 1
          : 0;
        // Larger chunks hold the scheduler longer; cap prefill to the configured chunk budget.
        const available = Math.min(
          s.prefillRate * MODELS[w.model].speed * prefillShare * STEP,
          c.batchTokens,
        );
        let remaining = available;
        for (const j of prefills) {
          const work = Math.min(j.remainingPrefill, remaining);
          j.remainingPrefill -= work;
          remaining -= work;
          if (j.remainingPrefill <= 0 && c.cache && j.request.prefix) {
            const key = cacheKey(j.request);
            if (!w.cache.has(key)) {
              w.cache.set(key, j.request.prefixTokens);
              w.cacheTokens += j.request.prefixTokens;
              evict(w, 0);
            }
          }
          if (remaining <= 0) break;
        }
        const usedPre =
          (available - remaining) /
          (s.prefillRate * MODELS[w.model].speed * STEP);
        const decodeShare = decodes.length ? 1 - usedPre : 0;
        const totalDecode =
          Math.min(55 * decodes.length, s.decodeRate) *
          MODELS[w.model].speed *
          decodeShare *
          STEP;
        let usedDecode = 0;
        for (const j of decodes) {
          const tokens = Math.min(
            j.remainingOutput,
            totalDecode / decodes.length,
          );
          j.remainingOutput -= tokens;
          if (
            j.request.output - j.remainingOutput >= 1 - 1e-9 &&
            j.first === null
          )
            j.first = t + STEP;
          usedDecode += tokens;
          if (j.remainingOutput <= 0.00001) {
            j.finish = t + STEP;
            done.push(j);
            w.kv -= j.kv;
          }
        }
        const decodeBusy = decodes.length
          ? usedDecode /
            (Math.min(55 * decodes.length, s.decodeRate) *
              MODELS[w.model].speed *
              STEP)
          : 0;
        w.busy += Math.min(1, usedPre + decodeBusy) * STEP;
        w.peak = Math.max(
          w.peak,
          MODELS[w.model].residentGB + w.kv + w.cacheTokens * KV_GB_PER_TOKEN,
        );
        w.active = w.active.filter((j) => j.finish === null);
      }
    }
    if (t - lastSample >= 5 || t === 0) {
      const busy = workers.reduce((sum, w) => sum + w.busy, 0);
      const complete = done.filter((j) => !j.failed).length;
      series.push({
        time: Math.round(t),
        arrivals: next - lastArrivals,
        completed: complete - lastComplete,
        utilization:
          t === 0
            ? 0
            : ((busy - lastBusy) / ((t - lastSample) * workers.length)) * 100,
        queue: workers.reduce((sum, w) => sum + w.queue.length, 0),
      });
      lastSample = t;
      lastArrivals = next;
      lastComplete = complete;
      lastBusy = busy;
    }
    if (
      t >= trace.duration &&
      workers.every((w) => !w.active.length && !w.queue.length)
    )
      break;
  }
  for (const w of workers) {
    for (const j of w.active) done.push({ ...j, failed: true });
    for (const r of w.queue)
      done.push({
        request: r,
        remainingPrefill: r.input,
        remainingOutput: r.output,
        first: null,
        finish: null,
        admitted: t,
        cached: 0,
        kv: 0,
        failed: true,
      });
  }
  const complete = done.filter((j) => !j.failed && j.finish !== null);
  const ttft = (j: Job) => (j.first ?? t) - j.request.arrival;
  const itl = (j: Job) =>
    j.finish === null
      ? Infinity
      : ((j.finish - (j.first ?? j.finish)) /
          Math.max(1, j.request.output - 1)) *
        1000;
  const compliant = complete.filter(
    (j) => ttft(j) <= s.ttftSlo && itl(j) <= s.itlSlo,
  );
  const elapsed = Math.max(trace.duration, t);
  const hourlyCost = workers.length * s.price;
  const cost = (hourlyCost * elapsed) / 3600;
  const outputTokens = complete.reduce((sum, j) => sum + j.request.output, 0);
  const compliantTokens = compliant.reduce(
    (sum, j) => sum + j.request.output,
    0,
  );
  const failed = trace.requests.length - complete.length;
  const p95ttft = percentile(complete.map(ttft));
  const p95itl = percentile(complete.map(itl));
  const reasons: string[] = [];
  if (!trace.requests.length)
    reasons.push('Insufficient evidence: no requests were offered');
  if (failed / trace.requests.length > 0.01)
    reasons.push(`${failed} requests failed or exceeded the drain window`);
  if (p95ttft > s.ttftSlo)
    reasons.push(
      `p95 first token ${p95ttft.toFixed(2)}s exceeds ${s.ttftSlo.toFixed(1)}s`,
    );
  if (p95itl > s.itlSlo)
    reasons.push(
      `p95 token interval ${p95itl.toFixed(0)}ms exceeds ${s.itlSlo}ms`,
    );
  if (compliant.length / trace.requests.length < 0.95)
    reasons.push('Fewer than 95% of requests met both latency targets');
  const result: Result = {
    config: c,
    traceHash: hash(trace),
    count: trace.requests.length,
    completed: complete.length,
    failed,
    compliant: compliant.length,
    p95ttft,
    p95itl,
    p95e2e: percentile(complete.map((j) => j.finish! - j.request.arrival)),
    cacheHit:
      (workers.reduce((sum, w) => sum + w.cached, 0) /
        Math.max(
          1,
          trace.requests.reduce((sum, r) => sum + r.input, 0),
        )) *
      100,
    utilization:
      (workers.reduce((sum, w) => sum + w.busy, 0) /
        (workers.length * elapsed)) *
      100,
    outputTokens,
    throughput: outputTokens / elapsed,
    cost,
    hourlyCost,
    costPerMillion: compliantTokens ? (cost / compliantTokens) * 1e6 : null,
    elapsed,
    feasible: reasons.length === 0,
    reasons,
    workers: workers.map((w) => ({
      id: w.id,
      node: w.node,
      model: w.model,
      utilization: (w.busy / elapsed) * 100,
      requests: w.requests,
      cachedTokens: w.cached,
      peakMemoryGB: w.peak,
    })),
    series,
  };
  return result;
}
export function candidateConfigs(
  base: Config,
  scope: Scope,
): { config: Config; rationale: string }[] {
  const tuned = {
    ...base,
    concurrency: 16,
    prefillShare: 0.35,
    routing: 'prefix-affinity' as const,
  };
  const options = [
    {
      config: { ...tuned, id: 'balanced', name: 'Cache-aware · balanced' },
      rationale:
        'Keep the model fixed. Combine prefix-affinity routing with a larger admission limit and more decode headroom.',
    },
    {
      config: { ...tuned, id: 'prefill', name: 'Prefill throughput' },
      rationale:
        'Give prefill 80% of GPU time when decoding is active; test the tradeoff against token latency.',
    },
    {
      config: { ...tuned, id: 'decode', name: 'Decode priority' },
      rationale:
        'Reserve 80% of shared GPU time for generation. Useful only if the first-token target still passes.',
    },
    {
      config: {
        ...base,
        id: 'no-cache',
        name: 'Cache-off control',
        cache: false,
      },
      rationale:
        'Diagnostic control: measure how much repeated-prefix reuse contributes.',
    },
  ];
  options[1].config.prefillShare = 0.8;
  options[2].config.prefillShare = 0.2;
  if (scope === 'fleet') {
    options.unshift({
      config: {
        ...tuned,
        id: 'consolidate',
        name: 'Consolidate to two nodes',
        nodes: 2,
        prefillShare: 0.75,
      },
      rationale:
        'Preserve a dedicated replica of each model on each node. Test whether two nodes can carry the same offered traffic.',
    });
    options.push({
      config: {
        ...tuned,
        id: 'aggressive',
        name: 'Consolidate to one node',
        nodes: 1,
      },
      rationale:
        'Challenge the lower capacity bound. Reject if either model violates the service targets.',
    });
  }
  return options.filter(
    (o) =>
      hash({ ...o.config, id: '', name: '' }) !==
      hash({ ...base, id: '', name: '' }),
  );
}
export function rankCandidates(candidates: Candidate[]) {
  return [...candidates].sort(
    (a, b) =>
      Number(b.result.feasible) - Number(a.result.feasible) ||
      a.result.cost - b.result.cost ||
      a.result.p95ttft - b.result.p95ttft,
  );
}
