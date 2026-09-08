/** Local-only import contract. Imported inventory never becomes simulated traffic or measured performance. */
export interface ObservedPod {
  name: string;
  namespace: string;
  node: string | null;
  phase: string;
  ready: boolean;
  labels: Record<string, string>;
  accelerators: Record<string, string | number>[];
}
export interface GkeSnapshot {
  schemaVersion: 1;
  kind: 'inference-autopilot.gke-snapshot';
  source: 'example' | 'gke-observer';
  mode: 'observe-only';
  ready: boolean;
  observedAt: number;
  pods: ObservedPod[];
  errors: string[];
}
export interface ObservedReplica {
  id: string;
  model: string;
  replica: string;
  namespace: string;
  hardware: string;
  role: string;
  tp: number;
  pp: number;
  ep: number;
  pods: number;
  hosts: string[];
  chips: number;
  expectedChips: number;
  readyCandidate: boolean;
  issues: string[];
}
const LABELS = [
  'autopilot/model',
  'autopilot/replica',
  'autopilot/hardware',
  'autopilot/role',
  'autopilot/tp',
  'autopilot/pp',
  'autopilot/ep',
  'autopilot/dp',
  'autopilot/group',
  'app.kubernetes.io/name',
];
function object(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw Error('Expected a JSON object.');
  return x as Record<string, unknown>;
}
function text(x: unknown, limit = 200): string {
  if (typeof x !== 'string' || x.length > limit)
    throw Error('Missing or oversized text field.');
  return x;
}
export function parseGkeSnapshot(raw: string): GkeSnapshot {
  if (raw.length > 2_000_000)
    throw Error('Snapshot exceeds the 2 MB import limit.');
  const v = object(JSON.parse(raw));
  if (
    v.schemaVersion !== 1 ||
    v.kind !== 'inference-autopilot.gke-snapshot' ||
    v.mode !== 'observe-only' ||
    !['example', 'gke-observer'].includes(String(v.source))
  )
    throw Error('Use a version 1 snapshot exported by the GKE observer.');
  if (
    typeof v.ready !== 'boolean' ||
    typeof v.observedAt !== 'number' ||
    !Number.isFinite(v.observedAt) ||
    v.observedAt <= 0
  )
    throw Error('Snapshot readiness or observation time is invalid.');
  if (
    !Array.isArray(v.pods) ||
    v.pods.length > 5000 ||
    !Array.isArray(v.errors) ||
    v.errors.length > 50
  )
    throw Error('Snapshot inventory is invalid or too large.');
  const seen = new Set<string>();
  const pods = v.pods.map((value): ObservedPod => {
    const p = object(value),
      labels = object(p.labels);
    const name = text(p.name),
      namespace = text(p.namespace);
    const id = JSON.stringify([namespace, name]);
    if (seen.has(id)) throw Error('Duplicate pod identity in snapshot.');
    seen.add(id);
    if (
      typeof p.ready !== 'boolean' ||
      !Array.isArray(p.accelerators) ||
      p.accelerators.length > 100
    )
      throw Error('Invalid pod readiness or accelerator limits.');
    const safeLabels: Record<string, string> = {};
    for (const key of LABELS)
      if (labels[key] !== undefined) safeLabels[key] = text(labels[key], 100);
    const accelerators = p.accelerators.map((item) => {
      const a = object(item);
      const safe: Record<string, string | number> = {};
      for (const key of ['nvidia.com/gpu', 'google.com/tpu'])
        if (a[key] !== undefined) {
          const n = Number(a[key]);
          if (
            !Number.isInteger(n) ||
            n < 0 ||
            n > 1024 ||
            !['string', 'number'].includes(typeof a[key])
          )
            throw Error('Invalid accelerator count.');
          safe[key] = n;
        }
      return safe;
    });
    return {
      name,
      namespace,
      node: p.node == null ? null : text(p.node),
      phase: p.phase == null ? 'Unknown' : text(p.phase),
      ready: p.ready,
      labels: safeLabels,
      accelerators,
    };
  });
  return {
    schemaVersion: 1,
    kind: 'inference-autopilot.gke-snapshot',
    source: v.source as GkeSnapshot['source'],
    mode: 'observe-only',
    ready: v.ready,
    observedAt: v.observedAt,
    pods,
    errors: v.errors.map((e) => text(e)),
  };
}
function degree(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 1024 ? n : 0;
}
export function observedReplicas(snapshot: GkeSnapshot): {
  replicas: ObservedReplica[];
  unlabeledPods: number;
} {
  const groups = new Map<string, ObservedPod[]>();
  let unlabeledPods = 0;
  for (const p of snapshot.pods) {
    const l = p.labels;
    if (!l['autopilot/model'] || !l['autopilot/replica']) {
      unlabeledPods++;
      continue;
    }
    // Conflicting hardware is detected within a replica, never split into inflated counts.
    const id = JSON.stringify([
      p.namespace,
      l['autopilot/model'],
      l['autopilot/replica'],
      l['autopilot/role'] || 'combined',
    ]);
    groups.set(id, [...(groups.get(id) || []), p]);
  }
  const replicas = [...groups].map(([id, pods]): ObservedReplica => {
    const p = pods[0],
      l = p.labels;
    const tp = degree(l['autopilot/tp']),
      pp = degree(l['autopilot/pp']),
      ep = degree(l['autopilot/ep']);
    const chips = pods.reduce(
      (sum, pod) =>
        sum +
        pod.accelerators.reduce(
          (n, a) =>
            n + Object.values(a).reduce<number>((v, x) => v + Number(x), 0),
          0,
        ),
      0,
    );
    const issues: string[] = [];
    for (const key of [
      'autopilot/tp',
      'autopilot/pp',
      'autopilot/ep',
      'autopilot/hardware',
      'autopilot/dp',
    ])
      if (pods.some((pod) => pod.labels[key] !== l[key]))
        issues.push(`Inconsistent ${key.split('/')[1]} declarations`);
    if (!tp || !pp || !ep) issues.push('Missing or invalid parallelism labels');
    if (ep > tp || (ep && tp % ep !== 0))
      issues.push('Expert group does not fit the declared TP ranks under DP=1');
    if (degree(l['autopilot/dp']) !== 1)
      issues.push('Label one complete serving copy per replica with DP=1');
    if (!l['autopilot/hardware']) issues.push('Hardware type is not declared');
    if (chips !== tp * pp)
      issues.push(`Reserved chips ${chips} do not match TP × PP (${tp * pp})`);
    if (!pods.every((pod) => pod.ready && pod.phase === 'Running' && pod.node))
      issues.push('Some worker pods are not scheduled, running, and ready');
    if (
      pods.some((pod) =>
        pod.accelerators.some((a) =>
          Object.keys(a).some(
            (key) =>
              (l['autopilot/hardware'] === 'tpuv7') !==
              (key === 'google.com/tpu'),
          ),
        ),
      )
    )
      issues.push('Accelerator resource type conflicts with hardware label');
    if (!snapshot.ready || snapshot.errors.length)
      issues.push('Observer snapshot is unhealthy');
    return {
      id,
      model: l['autopilot/model'],
      replica: l['autopilot/replica'],
      namespace: p.namespace,
      hardware: l['autopilot/hardware'] || 'unknown',
      role: l['autopilot/role'] || 'combined',
      tp,
      pp,
      ep,
      pods: pods.length,
      hosts: [...new Set(pods.flatMap((pod) => (pod.node ? [pod.node] : [])))],
      chips,
      expectedChips: tp * pp,
      readyCandidate: issues.length === 0,
      issues,
    };
  });
  return { replicas, unlabeledPods };
}
