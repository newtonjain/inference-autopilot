import { MODEL_IDS, INITIAL_NODES, validateProfile } from './fleet-engine';
import type { FleetProfile, WorkloadConfig } from './fleet-engine';
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('Expected an object.');
  return v as Record<string, unknown>;
}
function num(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error('Invalid numeric configuration.');
  return v;
}
export function parseWorkload(v: unknown): WorkloadConfig {
  const w = record(v),
    mix = record(w.mix);
  const result = {
    rps: num(w.rps, 1, 300),
    inputTokens: num(w.inputTokens, 1, 16000),
    outputTokens: num(w.outputTokens, 1, 2000),
    sharedPrefix: num(w.sharedPrefix, 0, 1),
    burstiness: num(w.burstiness, 0, 1),
    concurrency: num(w.concurrency, 1, 1024),
    ttftTargetMs: num(w.ttftTargetMs, 1, 10000),
    tokenTargetMs: num(w.tokenTargetMs, 1, 300),
    mix: {
      gemma: num(mix.gemma, 0, 100),
      qwen: num(mix.qwen, 0, 100),
      kimi: num(mix.kimi, 0, 100),
    },
  };
  if (!Object.values(result.mix).some((x) => x > 0))
    throw Error('Model demand cannot be empty.');
  return result;
}
export function parseProfile(v: unknown): FleetProfile {
  const p = record(v);
  if (!Array.isArray(p.placements) || p.placements.length > 32)
    throw Error('Invalid placements.');
  for (const k of ['prefixCache', 'cacheAffinity', 'autoscale'])
    if (typeof p[k] !== 'boolean') throw Error('Invalid serving flags.');
  const profile: FleetProfile = {
    id: typeof p.id === 'string' ? p.id.slice(0, 100) : 'current',
    name: typeof p.name === 'string' ? p.name.slice(0, 100) : 'Current profile',
    prefixCache: p.prefixCache as boolean,
    cacheAffinity: p.cacheAffinity as boolean,
    autoscale: p.autoscale as boolean,
    batchConcurrency: num(p.batchConcurrency, 1, 64),
    headroom: num(p.headroom, 0, 0.8),
    placements: p.placements.map((value, i) => {
      const r = record(value);
      if (
        !MODEL_IDS.includes(r.model as never) ||
        !INITIAL_NODES.some((n) => n.id === r.nodeId)
      )
        throw Error('Unknown model or hardware allocation.');
      return {
        id: typeof r.id === 'string' ? r.id.slice(0, 100) : `p-${i}`,
        model: r.model as FleetProfile['placements'][number]['model'],
        nodeId: r.nodeId as string,
        replicas: num(r.replicas, 1, 8),
      };
    }),
  };
  const errors = validateProfile(profile);
  if (errors.length) throw Error(errors.join(' '));
  return profile;
}
export interface TelemetryWindow {
  schemaVersion: 1;
  kind: 'inference-autopilot.telemetry';
  source: 'gcp-managed-prometheus';
  rateKind: 'completed';
  latencyKind: 'mean';
  observedAt: string;
  startTime: string;
  endTime: string;
  models: {
    model: 'gemma' | 'qwen' | 'kimi';
    rps: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    ttftMs: number | null;
    tokenMs: number | null;
    queue: number | null;
    prefixHitRate: number | null;
  }[];
}
export function parseTelemetry(v: unknown): TelemetryWindow {
  const t = record(v);
  if (
    t.schemaVersion !== 1 ||
    t.kind !== 'inference-autopilot.telemetry' ||
    t.source !== 'gcp-managed-prometheus' ||
    t.rateKind !== 'completed' ||
    t.latencyKind !== 'mean'
  )
    throw Error('Use the normalized GCP telemetry exporter format.');
  const dates = ['observedAt', 'startTime', 'endTime'].map((k) => {
    if (
      typeof t[k] !== 'string' ||
      !Number.isFinite(Date.parse(t[k] as string))
    )
      throw Error('Invalid telemetry timestamp.');
    return new Date(t[k] as string).toISOString();
  });
  const [observedAt, startTime, endTime] = dates;
  if (
    Date.parse(endTime) <= Date.parse(startTime) ||
    Date.parse(endTime) - Date.parse(startTime) > 86400000 ||
    Date.parse(observedAt) > Date.now() + 300000 ||
    Date.parse(endTime) > Date.now() + 300000 ||
    Date.parse(endTime) > Date.parse(observedAt)
  )
    throw Error('Invalid telemetry window.');
  if (!Array.isArray(t.models) || t.models.length !== 3)
    throw Error(
      'Include exactly the three selected model rows, with null for missing observations.',
    );
  const seen = new Set();
  const models = t.models.map((value) => {
    const r = record(value);
    if (!MODEL_IDS.includes(r.model as never) || seen.has(r.model))
      throw Error('Invalid telemetry model.');
    seen.add(r.model);
    const metric = (key: string, max: number) =>
      r[key] === null ? null : num(r[key], 0, max);
    return {
      model: r.model as 'gemma' | 'qwen' | 'kimi',
      rps: metric('rps', 100000),
      inputTokens: metric('inputTokens', 1000000),
      outputTokens: metric('outputTokens', 1000000),
      ttftMs: metric('ttftMs', 3600000),
      tokenMs: metric('tokenMs', 3600000),
      queue: metric('queue', 1000000),
      prefixHitRate: metric('prefixHitRate', 1),
    };
  });
  return {
    schemaVersion: 1,
    kind: 'inference-autopilot.telemetry',
    source: 'gcp-managed-prometheus',
    rateKind: 'completed',
    latencyKind: 'mean',
    observedAt,
    startTime,
    endTime,
    models,
  };
}
export function telemetryWorkload(
  t: TelemetryWindow,
  base: WorkloadConfig,
): WorkloadConfig {
  if (Date.now() - Date.parse(t.endTime) > 3600000)
    throw Error('Telemetry is older than one hour. Import a fresh window.');
  if (
    t.models.some(
      (m) =>
        m.rps === null || m.inputTokens === null || m.outputTokens === null,
    )
  )
    throw Error(
      'Complete rate and token measurements are needed for every model.',
    );
  const total = t.models.reduce((n, m) => n + m.rps!, 0);
  if (total <= 0 || total > 300)
    throw Error(
      'Observed throughput is outside the supported 1–300 req/s replay range.',
    );
  const weighted = (key: 'inputTokens' | 'outputTokens' | 'prefixHitRate') =>
    t.models.reduce((n, m) => n + (m[key] ?? 0) * m.rps!, 0) / total;
  return parseWorkload({
    ...base,
    rps: total,
    inputTokens: Math.max(1, weighted('inputTokens')),
    outputTokens: Math.max(1, weighted('outputTokens')),
    sharedPrefix: weighted('prefixHitRate'),
    mix: Object.fromEntries(t.models.map((m) => [m.model, m.rps! / total])),
  });
}
