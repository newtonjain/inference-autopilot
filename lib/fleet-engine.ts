/** Synthetic fluid simulation, not a hardware benchmark or verified model fit.
 * Each tick offers fractional requests, shares a finite service budget and bounds
 * admission by configured concurrency. Queued requests retain their original model.
 */
export const MODEL_IDS = ['gemma', 'qwen', 'kimi'] as const;
export type FleetModelId = (typeof MODEL_IDS)[number];
export type HardwareId = 'h200' | 'gb200' | 'gb300' | 'tpuv7';
export const HARDWARE = {
  h200: { name: 'H200 serving group', factor: 1 },
  gb200: { name: 'GB200 serving group', factor: 1.4 },
  gb300: { name: 'GB300 serving group', factor: 1.8 },
  tpuv7: { name: 'TPU v7 serving group', factor: 1.1 },
} as const;
export const MODELS: Record<
  FleetModelId,
  {
    name: string;
    shortName: string;
    color: string;
    supportedHardware: HardwareId[];
    requiredChips: number;
    residentGB: number;
    workPerSecond: number;
    assumption: string;
  }
> = {
  gemma: {
    name: 'Gemma 4 26B',
    shortName: 'Gemma',
    color: '#6ea8ff',
    supportedHardware: ['h200', 'gb200', 'gb300', 'tpuv7'],
    requiredChips: 1,
    residentGB: 64,
    workPerSecond: 5000,
    assumption:
      'Scenario label; 64 GB total residency and illustrative TPU compatibility, not verified support.',
  },
  qwen: {
    name: 'Qwen 3.5 397B',
    shortName: 'Qwen',
    color: '#bd98ff',
    supportedHardware: ['h200', 'gb200', 'gb300'],
    requiredChips: 4,
    residentGB: 480,
    workPerSecond: 2500,
    assumption:
      'Synthetic quantized residency: 480 GB across four GPU chips per replica; not a measured fit.',
  },
  kimi: {
    name: 'Kimi K3',
    shortName: 'Kimi',
    color: '#f7a668',
    supportedHardware: ['gb300'],
    requiredChips: 8,
    residentGB: 1600,
    workPerSecond: 1800,
    assumption:
      '2.8T total parameters: assumes 1,600 GB quantized residency across eight GB300 GPUs, including a provisional overhead budget. Service rate is synthetic.',
  },
};
export interface FleetNode {
  id: string;
  hardware: HardwareId;
  label: string;
  chips: number;
  memoryGBPerChip: number;
  hourlyCost: number;
  modelSlots: number;
}
export const INITIAL_NODES: FleetNode[] = [
  {
    id: 'h200-a',
    hardware: 'h200',
    label: 'H200 · A',
    chips: 4,
    memoryGBPerChip: 141,
    hourlyCost: 16,
    modelSlots: 4,
  },
  {
    id: 'h200-b',
    hardware: 'h200',
    label: 'H200 · B',
    chips: 4,
    memoryGBPerChip: 141,
    hourlyCost: 16,
    modelSlots: 4,
  },
  {
    id: 'gb200-a',
    hardware: 'gb200',
    label: 'GB200 · A',
    chips: 8,
    memoryGBPerChip: 186,
    hourlyCost: 40,
    modelSlots: 4,
  },
  {
    id: 'gb200-b',
    hardware: 'gb200',
    label: 'GB200 · B',
    chips: 8,
    memoryGBPerChip: 186,
    hourlyCost: 40,
    modelSlots: 4,
  },
  {
    id: 'gb300-a',
    hardware: 'gb300',
    label: 'GB300 · A',
    chips: 8,
    memoryGBPerChip: 288,
    hourlyCost: 48,
    modelSlots: 4,
  },
  {
    id: 'gb300-b',
    hardware: 'gb300',
    label: 'GB300 · B',
    chips: 8,
    memoryGBPerChip: 288,
    hourlyCost: 48,
    modelSlots: 4,
  },
  {
    id: 'gb300-c',
    hardware: 'gb300',
    label: 'GB300 · C',
    chips: 8,
    memoryGBPerChip: 288,
    hourlyCost: 48,
    modelSlots: 4,
  },
  {
    id: 'tpuv7-a',
    hardware: 'tpuv7',
    label: 'TPU v7 · A',
    chips: 4,
    memoryGBPerChip: 206.158430208,
    hourlyCost: 14,
    modelSlots: 4,
  },
];
export interface WorkloadConfig {
  rps: number;
  inputTokens: number;
  outputTokens: number;
  sharedPrefix: number;
  burstiness: number;
  concurrency: number;
  ttftTargetMs: number;
  tokenTargetMs: number;
  mix: Record<FleetModelId, number>;
}
export interface Placement {
  id: string;
  nodeId: string;
  model: FleetModelId;
  replicas: number;
}
export interface FleetProfile {
  id: string;
  name: string;
  placements: Placement[];
  prefixCache: boolean;
  cacheAffinity: boolean;
  batchConcurrency: number;
  headroom: number;
  autoscale: boolean;
}
export interface Replica {
  id: string;
  placementId: string;
  nodeId: string;
  model: FleetModelId;
  status: 'warming' | 'ready' | 'draining';
  readyAt: number;
  queue: number;
  utilization: number;
  ttftMs: number;
  outputTokensPerSecond: number;
}
export interface ModelMetrics {
  incomingRps: number;
  servedRps: number;
  queue: number;
  ttftMs: number;
  tokenMs: number;
  utilization: number;
  completed: number;
  failed: number;
}
export interface FleetEvent {
  id: string;
  time: number;
  model: FleetModelId;
  nodeId: string;
  type: 'route' | 'scale' | 'warning' | 'ready';
  message: string;
}
export interface FleetState {
  profile: FleetProfile;
  workload: WorkloadConfig;
  time: number;
  replicas: Replica[];
  modelMetrics: Record<FleetModelId, ModelMetrics>;
  events: FleetEvent[];
  totalCost: number;
  arrivals: number;
  completed: number;
  failed: number;
  seed: number;
  sloCompleted: number;
  nextReplica: number;
  lastScale: number;
}
export interface Summary {
  hourlyCost: number;
  outputTokensPerSecond: number;
  ttftMs: number;
  sloPassRate: number;
  utilization: number;
  queue: number;
  activeReplicas: number;
  readyReplicas: number;
}
export interface Evaluation {
  summary: Summary;
  feasible: boolean;
  reasons: string[];
  completed: number;
  failed: number;
  cost: number;
}
export const defaultWorkload = (): WorkloadConfig => ({
  rps: 24,
  inputTokens: 1200,
  outputTokens: 300,
  sharedPrefix: 0.65,
  burstiness: 0.15,
  concurrency: 128,
  ttftTargetMs: 800,
  tokenTargetMs: 70,
  mix: { gemma: 0.45, qwen: 0.3, kimi: 0.25 },
});
export const defaultProfile = (): FleetProfile => ({
  id: 'baseline',
  name: 'Current deployment',
  placements: [
    { id: 'gemma-main', nodeId: 'h200-a', model: 'gemma', replicas: 1 },
    { id: 'qwen-main', nodeId: 'gb200-a', model: 'qwen', replicas: 1 },
    { id: 'kimi-main', nodeId: 'gb300-a', model: 'kimi', replicas: 1 },
  ],
  prefixCache: false,
  cacheAffinity: false,
  batchConcurrency: 8,
  headroom: 0.15,
  autoscale: true,
});
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const nodeById = (id: string) => INITIAL_NODES.find((n) => n.id === id);
const emptyMetrics = (): ModelMetrics => ({
  incomingRps: 0,
  servedRps: 0,
  queue: 0,
  ttftMs: 0,
  tokenMs: 0,
  utilization: 0,
  completed: 0,
  failed: 0,
});
export function validateProfile(profile: FleetProfile): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (
    !Number.isFinite(profile.batchConcurrency) ||
    profile.batchConcurrency < 1
  )
    errors.push('Batch concurrency must be positive.');
  if (
    !Number.isFinite(profile.headroom) ||
    profile.headroom < 0 ||
    profile.headroom > 0.8
  )
    errors.push('Headroom must be between 0 and 0.8.');
  for (const p of profile.placements) {
    const n = nodeById(p.nodeId),
      m = MODELS[p.model];
    if (ids.has(p.id)) errors.push(`Duplicate placement ${p.id}.`);
    ids.add(p.id);
    if (!Number.isInteger(p.replicas) || p.replicas < 1)
      errors.push(`${p.id}: replica count must be a positive integer.`);
    if (!n || !m) {
      errors.push(`${p.id}: unknown node or model.`);
      continue;
    }
    if (!m.supportedHardware.includes(n.hardware))
      errors.push(
        `${m.name} is not enabled on ${n.hardware} in this simulation.`,
      );
    if (m.residentGB > n.memoryGBPerChip * m.requiredChips)
      errors.push(`${p.id}: insufficient modeled memory.`);
  }
  for (const n of INITIAL_NODES) {
    const ps = profile.placements.filter((p) => p.nodeId === n.id);
    if (
      ps.reduce(
        (v, p) => v + (MODELS[p.model]?.requiredChips ?? 100) * p.replicas,
        0,
      ) > n.chips
    )
      errors.push(`${n.label}: chip capacity exceeded.`);
    if (ps.reduce((v, p) => v + p.replicas, 0) > n.modelSlots)
      errors.push(`${n.label}: replica slots exceeded.`);
  }
  return errors;
}
function cleanWorkload(w: WorkloadConfig): WorkloadConfig {
  const d = defaultWorkload();
  const finite = (x: number, f: number) => (Number.isFinite(x) ? x : f);
  return {
    ...w,
    rps: clamp(finite(w.rps, d.rps), 0, 10000),
    inputTokens: clamp(finite(w.inputTokens, d.inputTokens), 1, 128000),
    outputTokens: clamp(finite(w.outputTokens, d.outputTokens), 1, 32000),
    sharedPrefix: clamp(finite(w.sharedPrefix, 0), 0, 1),
    burstiness: clamp(finite(w.burstiness, 0), 0, 1),
    concurrency: clamp(finite(w.concurrency, 128), 1, 100000),
    ttftTargetMs: Math.max(1, finite(w.ttftTargetMs, 800)),
    tokenTargetMs: Math.max(1, finite(w.tokenTargetMs, 70)),
    mix: Object.fromEntries(
      MODEL_IDS.map((m) => [m, Math.max(0, finite(w.mix[m], 0))]),
    ) as Record<FleetModelId, number>,
  };
}
export function createFleetState(
  profile = defaultProfile(),
  workload = defaultWorkload(),
  seed = 42,
): FleetState {
  const errors = validateProfile(profile);
  if (errors.length) throw new Error(errors.join(' '));
  let nextReplica = 0;
  return {
    profile: copy(profile),
    workload: cleanWorkload(workload),
    seed,
    time: 0,
    lastScale: -10,
    replicas: profile.placements.flatMap((p) =>
      Array.from({ length: p.replicas }, () => ({
        id: `replica-${nextReplica++}`,
        placementId: p.id,
        nodeId: p.nodeId,
        model: p.model,
        status: 'ready' as const,
        readyAt: 0,
        queue: 0,
        utilization: 0,
        ttftMs: 0,
        outputTokensPerSecond: 0,
      })),
    ),
    modelMetrics: {
      gemma: emptyMetrics(),
      qwen: emptyMetrics(),
      kimi: emptyMetrics(),
    },
    events: [],
    totalCost: 0,
    arrivals: 0,
    completed: 0,
    failed: 0,
    sloCompleted: 0,
    nextReplica: profile.placements.reduce((s, p) => s + p.replicas, 0),
  };
}
export function updateWorkload(
  state: FleetState,
  workload: WorkloadConfig,
): FleetState {
  return { ...state, workload: cleanWorkload(workload) };
}
/** Apply is an atomic logical switch; a controller must account for blue/green overlap separately. */
export function applyFleetProfile(
  state: FleetState,
  profile: FleetProfile,
): FleetState {
  const next = createFleetState(profile, state.workload, state.seed);
  // Preserve pending requests and lifetime accounting across logical switches.
  return {
    ...next,
    time: state.time,
    totalCost: state.totalCost,
    arrivals: state.arrivals,
    completed: state.completed,
    failed: state.failed,
    sloCompleted: state.sloCompleted,
    modelMetrics: copy(state.modelMetrics),
    events: copy(state.events),
  };
}
function capacity(s: FleetState, r: Replica): number {
  const w = s.workload,
    n = nodeById(r.nodeId)!;
  const reuse = s.profile.prefixCache
    ? w.sharedPrefix * (s.profile.cacheAffinity ? 0.88 : 0.55)
    : 0;
  const work = w.outputTokens + w.inputTokens * 0.2 * (1 - reuse);
  const batching = 0.7 + 0.3 * Math.min(1, s.profile.batchConcurrency / 32);
  return (
    (MODELS[r.model].workPerSecond * HARDWARE[n.hardware].factor * batching) /
    work
  );
}
function addEvent(
  s: FleetState,
  m: FleetModelId,
  nodeId: string,
  type: FleetEvent['type'],
  message: string,
) {
  s.events.push({
    id: `${s.time}-${s.events.length}-${s.nextReplica}`,
    time: s.time,
    model: m,
    nodeId,
    type,
    message,
  });
}
function canPlace(s: FleetState, model: FleetModelId, n: FleetNode): boolean {
  const peers = s.replicas.filter((r) => r.nodeId === n.id);
  return (
    MODELS[model].supportedHardware.includes(n.hardware) &&
    peers.length < n.modelSlots &&
    peers.reduce((sum, r) => sum + MODELS[r.model].requiredChips, 0) +
      MODELS[model].requiredChips <=
      n.chips &&
    MODELS[model].residentGB <= n.memoryGBPerChip * MODELS[model].requiredChips
  );
}
export function tickFleet(state: FleetState, seconds = 1): FleetState {
  const s = copy(state);
  const ticks = Math.max(0, Math.min(3600, Math.floor(seconds)));
  for (let tick = 0; tick < ticks; tick++) {
    s.time++;
    const w = s.workload;
    for (const r of s.replicas)
      if (r.status === 'warming' && s.time >= r.readyAt) {
        r.status = 'ready';
        addEvent(
          s,
          r.model,
          r.nodeId,
          'ready',
          `${MODELS[r.model].shortName} replica is ready after warm-up.`,
        );
      }
    const sumMix = MODEL_IDS.reduce((v, m) => v + w.mix[m], 0) || 1;
    // Seeded deterministic periodic arrival modulation: identical offered traffic for each profile.
    const wave =
      1 +
      w.burstiness *
        (0.7 * Math.sin((s.time + s.seed) / 8) +
          0.3 * Math.sin((s.time + s.seed) / 2.3));
    for (const m of MODEL_IDS) {
      const old = s.modelMetrics[m],
        rs = s.replicas.filter((r) => r.model === m && r.status === 'ready');
      const incoming = ((w.rps * w.mix[m]) / sumMix) * wave,
        cap = rs.reduce((v, r) => v + capacity(s, r), 0);
      const outstanding = old.queue + incoming;
      const maxQueued = (w.concurrency * w.mix[m]) / sumMix;
      const served = Math.min(outstanding, cap),
        failed = Math.max(0, outstanding - served - maxQueued),
        queue = Math.max(0, outstanding - served - failed);
      const util = cap ? Math.min(1, outstanding / cap) : incoming ? 1 : 0;
      const reuse = s.profile.prefixCache
        ? w.sharedPrefix * (s.profile.cacheAffinity ? 0.88 : 0.55)
        : 0;
      const base = 45 + w.inputTokens * (1 - reuse) * 0.035;
      const ttft =
        incoming || queue
          ? base +
            (cap ? (queue / cap) * 1000 : 10000) +
            Math.max(0, util - 0.7) * 180
          : 0;
      const tokenMs = rs.length ? 25 + util * 25 : incoming ? 10000 : 0;
      s.modelMetrics[m] = {
        incomingRps: incoming,
        servedRps: served,
        queue,
        ttftMs: ttft,
        tokenMs,
        utilization: util,
        completed: old.completed + served,
        failed: old.failed + failed,
      };
      s.arrivals += incoming;
      s.completed += served;
      s.failed += failed;
      if (ttft <= w.ttftTargetMs && tokenMs <= w.tokenTargetMs)
        s.sloCompleted += served;
      for (const r of rs) {
        const share = cap ? capacity(s, r) / cap : 0;
        r.queue = queue * share;
        r.utilization = util;
        r.ttftMs = ttft;
        r.outputTokensPerSecond = served * share * w.outputTokens;
      }
      if (rs.length && incoming > 0 && s.time % 3 === 0)
        addEvent(
          s,
          m,
          rs[s.time % rs.length].nodeId,
          'route',
          `${incoming.toFixed(1)} req/s routed to ${MODELS[m].shortName}.`,
        );
      if (failed > 0 && s.time % 5 === 0)
        addEvent(
          s,
          m,
          rs[0]?.nodeId ?? '',
          'warning',
          `${MODELS[m].shortName}: admission limit reached; requests rejected.`,
        );
      const warming = s.replicas.some(
        (r) => r.model === m && r.status === 'warming',
      );
      if (
        s.profile.autoscale &&
        !warming &&
        incoming > cap * (1 - s.profile.headroom) &&
        s.time - s.lastScale >= 5
      ) {
        const node = INITIAL_NODES.filter((n) => canPlace(s, m, n)).sort(
          (a, b) => {
            const aActive = s.replicas.some((r) => r.nodeId === a.id),
              bActive = s.replicas.some((r) => r.nodeId === b.id);
            return (
              Number(bActive) - Number(aActive) || a.hourlyCost - b.hourlyCost
            );
          },
        )[0];
        if (node) {
          const placementId = `auto-${m}-${node.id}`;
          const placement = s.profile.placements.find(
            (p) => p.id === placementId,
          );
          if (placement) placement.replicas++;
          else
            s.profile.placements.push({
              id: placementId,
              nodeId: node.id,
              model: m,
              replicas: 1,
            });
          s.replicas.push({
            id: `replica-${s.nextReplica++}`,
            placementId,
            nodeId: node.id,
            model: m,
            status: 'warming',
            readyAt: s.time + 8,
            queue: 0,
            utilization: 0,
            ttftMs: 0,
            outputTokensPerSecond: 0,
          });
          s.lastScale = s.time;
          addEvent(
            s,
            m,
            node.id,
            'scale',
            `Allocating ${MODELS[m].requiredChips} chips for ${MODELS[m].shortName}; ready in 8 simulated seconds.`,
          );
        }
      }
    }
    s.totalCost += summarize(s).hourlyCost / 3600;
    s.events = s.events.slice(-48);
  }
  return s;
}
export function summarize(s: FleetState): Summary {
  const nodes = new Set(s.replicas.map((r) => r.nodeId));
  const active = s.replicas.length,
    ready = s.replicas.filter((r) => r.status === 'ready');
  const traffic = MODEL_IDS.reduce(
    (v, m) => v + s.modelMetrics[m].incomingRps,
    0,
  );
  return {
    hourlyCost: INITIAL_NODES.filter((n) => nodes.has(n.id)).reduce(
      (v, n) => v + n.hourlyCost,
      0,
    ),
    outputTokensPerSecond: ready.reduce(
      (v, r) => v + r.outputTokensPerSecond,
      0,
    ),
    ttftMs: traffic
      ? MODEL_IDS.reduce(
          (v, m) =>
            v + s.modelMetrics[m].ttftMs * s.modelMetrics[m].incomingRps,
          0,
        ) / traffic
      : 0,
    sloPassRate: s.arrivals ? clamp(s.sloCompleted / s.arrivals, 0, 1) : 1,
    utilization: ready.length
      ? ready.reduce((v, r) => v + r.utilization, 0) / ready.length
      : 0,
    queue: MODEL_IDS.reduce((v, m) => v + s.modelMetrics[m].queue, 0),
    activeReplicas: active,
    readyReplicas: ready.length,
  };
}
export function evaluateProfile(
  profile: FleetProfile,
  workload: WorkloadConfig,
  seconds = 90,
  seed = 42,
): Evaluation {
  const invalid = validateProfile(profile);
  if (
    workload.rps <= 0 ||
    MODEL_IDS.reduce((sum, m) => sum + workload.mix[m], 0) <= 0
  )
    invalid.push('Experiment requires positive offered traffic and model mix.');
  if (invalid.length)
    return {
      summary: {
        hourlyCost: 0,
        outputTokensPerSecond: 0,
        ttftMs: 0,
        sloPassRate: 0,
        utilization: 0,
        queue: 0,
        activeReplicas: 0,
        readyReplicas: 0,
      },
      feasible: false,
      reasons: invalid,
      completed: 0,
      failed: 0,
      cost: 0,
    };
  const s = tickFleet(createFleetState(profile, workload, seed), seconds),
    summary = summarize(s),
    reasons: string[] = [];
  for (const m of MODEL_IDS)
    if (workload.mix[m] > 0 && workload.rps > 0) {
      const mm = s.modelMetrics[m];
      if (mm.ttftMs > workload.ttftTargetMs)
        reasons.push(
          `${MODELS[m].shortName} TTFT exceeds ${workload.ttftTargetMs} ms.`,
        );
      if (mm.tokenMs > workload.tokenTargetMs)
        reasons.push(`${MODELS[m].shortName} token latency exceeds target.`);
    }
  if (s.arrivals && s.failed / s.arrivals > 0.01)
    reasons.push('More than 1% of requests rejected.');
  if (summary.sloPassRate < 0.95)
    reasons.push(
      'Fewer than 95% of offered requests completed within both latency targets.',
    );
  return {
    summary,
    feasible: reasons.length === 0,
    reasons,
    completed: s.completed,
    failed: s.failed,
    cost: s.totalCost,
  };
}
export function recommendProfiles(
  profile: FleetProfile,
  workload: WorkloadConfig,
): {
  profile: FleetProfile;
  prescription: string[];
  reason: string;
  goal: 'latency' | 'cost' | 'throughput';
  evaluation: Evaluation;
}[] {
  const tuned: FleetProfile = {
    ...copy(profile),
    id: 'cache-tuned',
    name: 'Cache-aware serving',
    prefixCache: true,
    cacheAffinity: true,
    batchConcurrency: 32,
    autoscale: false,
  };
  const consolidated: FleetProfile = {
    ...copy(tuned),
    id: 'consolidated',
    name: 'Consolidate GPU footprint',
    placements: [
      { id: 'gemma-packed', nodeId: 'gb200-a', model: 'gemma', replicas: 2 },
      { id: 'qwen-gpu', nodeId: 'gb200-a', model: 'qwen', replicas: 1 },
      { id: 'kimi-gpu', nodeId: 'gb300-a', model: 'kimi', replicas: 1 },
    ],
  };
  const elastic: FleetProfile = {
    ...copy(tuned),
    id: 'elastic',
    name: 'Burst-ready elastic fleet',
    autoscale: true,
    headroom: 0.3,
    placements: [...copy(tuned.placements)],
  };
  // Pre-provision spare compatible replicas to avoid reactive cold-start penalties.
  const warm = createFleetState(elastic, workload);
  for (const m of MODEL_IDS) {
    const n = INITIAL_NODES.find((n) => canPlace(warm, m, n));
    if (n) {
      const p = { id: `reserve-${m}`, nodeId: n.id, model: m, replicas: 1 };
      elastic.placements.push(p);
      warm.replicas.push({
        id: p.id,
        placementId: p.id,
        nodeId: n.id,
        model: m,
        status: 'ready',
        readyAt: 0,
        queue: 0,
        utilization: 0,
        ttftMs: 0,
        outputTokensPerSecond: 0,
      });
    }
  }
  return [
    {
      profile: tuned,
      prescription: [
        'Enable prefix cache and model-specific cache-affinity routing.',
        'Raise batch concurrency to 32; hold placement fixed for a controlled comparison.',
        'Disable reactive scaling during this fixed-profile experiment.',
      ],
      reason: 'Reduce repeated prefill work and improve batching efficiency.',
      goal: 'latency' as const,
    },
    {
      profile: consolidated,
      prescription: [
        'Co-locate two Gemma replicas and one four-chip Qwen replica on GB200 A.',
        'Keep Kimi on its dedicated eight-chip GB300 A serving group.',
        `Drain the H200 node after verification; assumed active-node billing falls to $${summarize(createFleetState(consolidated, workload)).hourlyCost}/hour.`,
      ],
      reason:
        'Pack compatible workloads into fewer paid nodes without changing model identity.',
      goal: 'cost' as const,
    },
    {
      profile: elastic,
      prescription: [
        'Enable cache reuse and 32-way batching.',
        'Pre-warm one additional compatible replica per model where capacity permits.',
        'Scale into available compatible slots at 70% demand/capacity; new replicas take 8 simulated seconds.',
      ],
      reason:
        'Reserve burst capacity and reduce queue growth during model-specific demand spikes.',
      goal: 'throughput' as const,
    },
  ].map((c) => ({ ...c, evaluation: evaluateProfile(c.profile, workload) }));
}
