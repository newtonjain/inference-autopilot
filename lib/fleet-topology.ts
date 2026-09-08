/** A derived, illustrative rank view. This does not add distributed performance to the fluid engine. */
import {
  HARDWARE,
  INITIAL_NODES,
  MODELS,
  MODEL_IDS,
  type FleetModelId,
  type FleetState,
  type HardwareId,
  type Replica,
} from './fleet-engine';

export type TopologyPool = 'blue' | 'green';
export interface TopologyRank {
  rank: number;
  chipIndex: number;
  nodeId: string;
  physicalNodeId: string;
  tpRank: number;
  ppRank: number;
  expertRank: number | null;
}
export interface ReplicaTopology {
  id: string;
  replicaId: string;
  pool: TopologyPool;
  model: FleetModelId;
  hardware: HardwareId;
  nodeId: string;
  status: Replica['status'];
  tp: number;
  pp: number;
  ep: number;
  ranks: TopologyRank[];
  interNodeHops: number;
  dpGroupSize: number;
  strategy: string;
  caveat: string;
}
export interface ReplicaCount {
  model: FleetModelId;
  hardware: HardwareId;
  ready: number;
  warming: number;
  draining: number;
  total: number;
  chips: number;
  blue: number;
  green: number;
}
export interface FleetTopology {
  replicas: ReplicaTopology[];
  counts: ReplicaCount[];
  totals: {
    ready: number;
    warming: number;
    draining: number;
    replicas: number;
    chips: number;
  };
  notes: string[];
}
export const TOPOLOGY_SOURCES = [
  {
    title: 'GCP GPU machine topology',
    url: 'https://docs.cloud.google.com/compute/docs/gpus',
  },
  {
    title: 'vLLM parallelism and scaling',
    url: 'https://docs.vllm.ai/en/latest/serving/parallelism_scaling/',
  },
  {
    title: 'vLLM expert parallel deployment',
    url: 'https://docs.vllm.ai/en/latest/serving/expert_parallel_deployment/',
  },
  {
    title: 'vLLM disaggregated prefill',
    url: 'https://docs.vllm.ai/en/latest/features/disagg_prefill/',
  },
];
export const PARALLELISM_GUIDE = [
  {
    key: 'TP',
    name: 'Tensor parallelism',
    description:
      'Shard layer computation across cooperating accelerator ranks. Collective communication must fit the interconnect budget.',
  },
  {
    key: 'PP',
    name: 'Pipeline parallelism',
    description:
      'Place consecutive layer stages on different rank groups. Activations cross stage boundaries; pipeline bubbles can reduce efficiency.',
  },
  {
    key: 'EP',
    name: 'Expert parallelism',
    description:
      'Shard MoE experts over the same participating ranks used by the deployment. EP is not an extra multiplier of accelerator count; token dispatch adds communication.',
  },
  {
    key: 'DP',
    name: 'Replica scale-out',
    description:
      'Route independent requests to full serving replicas. Here DP means independent replicas, not a configured vLLM attention-DP or cross-replica expert group.',
  },
  {
    key: 'PD',
    name: 'Prefill / decode disaggregation',
    description:
      'Use separate model workers for prompt processing and token generation, transferring KV state between them. This requires extra model residency, compatible connectors, and measured transfer overhead.',
  },
];

/** Every accelerator rank belongs to exactly one replica within its pool. */
export function deriveFleetTopology(
  state: FleetState,
  green?: FleetState | null,
): FleetTopology {
  const counts: ReplicaCount[] = MODEL_IDS.flatMap((model) =>
    (Object.keys(HARDWARE) as HardwareId[]).map((hardware) => ({
      model,
      hardware,
      ready: 0,
      warming: 0,
      draining: 0,
      total: 0,
      chips: 0,
      blue: 0,
      green: 0,
    })),
  );
  const replicas: ReplicaTopology[] = [];
  const pools: [TopologyPool, FleetState][] = [['blue', state]];
  if (green) pools.push(['green', green]);
  for (const [pool, current] of pools) {
    const offsets = new Map<string, number>();
    // Pack large groups first so a four-rank TP group does not straddle modeled hosts.
    for (const replica of [...current.replicas].sort(
      (a, b) => MODELS[b.model].requiredChips - MODELS[a.model].requiredChips,
    )) {
      const node = INITIAL_NODES.find((n) => n.id === replica.nodeId);
      if (!node) throw new Error(`Unknown topology node: ${replica.nodeId}`);
      const chips = MODELS[replica.model].requiredChips;
      const offset = offsets.get(node.id) ?? 0;
      if (offset + chips > node.chips)
        throw new Error(`Topology exceeds chip capacity on ${pool}/${node.id}`);
      offsets.set(node.id, offset + chips);
      const chipsPerHost =
        node.hardware === 'gb200' || node.hardware === 'gb300' ? 4 : node.chips;
      const tp = Math.min(chips, chipsPerHost);
      const pp = chips / tp;
      const ep = replica.model === 'kimi' ? tp : 1;
      const dpGroupSize = current.replicas.filter(
        (r) => r.model === replica.model && r.status === 'ready',
      ).length;
      replicas.push({
        id: `${pool}/${replica.id}`,
        replicaId: replica.id,
        pool,
        model: replica.model,
        hardware: node.hardware,
        nodeId: node.id,
        status: replica.status,
        tp,
        pp,
        ep,
        dpGroupSize,
        interNodeHops: pp - 1,
        ranks: Array.from({ length: chips }, (_, rank) => ({
          rank,
          chipIndex: offset + rank,
          nodeId: node.id,
          physicalNodeId: `${node.id}/host-${Math.floor((offset + rank) / chipsPerHost) + 1}`,
          tpRank: rank % tp,
          ppRank: Math.floor(rank / tp),
          expertRank: ep > 1 ? rank % ep : null,
        })),
        strategy: `TP${tp} · PP${pp}${ep > 1 ? ` · EP${ep} (same ranks)` : ''}`,
        caveat:
          'Modeled placement: GB200/GB300 serving groups contain two four-chip hosts. TP/PP/EP runtime support and network performance remain unverified; H200 and TPU host layouts are illustrative.',
      });
      const count = counts.find(
        (c) => c.model === replica.model && c.hardware === node.hardware,
      )!;
      count[replica.status]++;
      count.total++;
      count.chips += chips;
      count[pool]++;
    }
  }
  return {
    replicas,
    counts,
    totals: {
      ready: counts.reduce((s, c) => s + c.ready, 0),
      warming: counts.reduce((s, c) => s + c.warming, 0),
      draining: counts.reduce((s, c) => s + c.draining, 0),
      replicas: replicas.length,
      chips: replicas.reduce((s, r) => s + r.ranks.length, 0),
    },
    notes: [
      'Active replicas occupy atomic serving groups. Eight-chip GB200/GB300 groups map to two modeled four-chip hosts; pipeline links are logical boundaries, not measured network hops.',
      'Blue and green are separately provisioned pools; equal node labels across pools represent separate capacity.',
      'Ready replica counts show request-level scale-out; warming and draining replicas do not add ready capacity.',
      'Alternative distributed and PD diagrams are architecture blueprints, not active placements or predicted speedups.',
    ],
  };
}
export interface DistributedBlueprint {
  id: string;
  model: FleetModelId;
  name: string;
  status: 'proposed';
  tp: number;
  pp: number;
  ep: number;
  dp: number;
  chipsPerReplica: number;
  totalChips: number;
  interNodeHops: number;
  stages: {
    id: string;
    label: string;
    role: 'pipeline' | 'prefill' | 'decode';
    chips: number;
    rankStart: number;
    rankEnd: number;
  }[];
  links: {
    from: string;
    to: string;
    kind: 'activation' | 'kv' | 'collective';
    label: string;
  }[];
  explanation: string;
  requirements: string[];
}
export const DISTRIBUTED_BLUEPRINTS: DistributedBlueprint[] = [
  {
    id: 'kimi-cross-host-tp8',
    model: 'kimi',
    name: 'Kimi · cross-host tensor group',
    status: 'proposed',
    tp: 8,
    pp: 1,
    ep: 8,
    dp: 1,
    chipsPerReplica: 8,
    totalChips: 8,
    interNodeHops: 1,
    stages: [
      {
        id: 'kimi-tp-a',
        label: 'Host A · TP ranks 0–3',
        role: 'pipeline',
        chips: 4,
        rankStart: 0,
        rankEnd: 3,
      },
      {
        id: 'kimi-tp-b',
        label: 'Host B · TP ranks 4–7',
        role: 'pipeline',
        chips: 4,
        rankStart: 4,
        rankEnd: 7,
      },
    ],
    links: [
      {
        from: 'kimi-tp-a',
        to: 'kimi-tp-b',
        kind: 'collective',
        label: 'Cross-host tensor collectives / expert dispatch',
      },
    ],
    explanation:
      'An alternative to modeled TP4 × PP2 uses TP8 across both four-chip hosts with PP1. These two rank blocks are one layer stage, not two pipeline stages. EP8 shares the same eight ranks.',
    requirements: [
      'Verify Kimi runtime support for the selected quantization and expert backend.',
      'Measure the actual inter-host fabric and collectives; do not assume NVLink or RDMA availability.',
      'Compare collective latency against pipeline bubbles under identical traffic.',
    ],
  },

  {
    id: 'qwen-tp4-pp2',
    model: 'qwen',
    name: 'Qwen · two-node pipeline',
    status: 'proposed',
    tp: 4,
    pp: 2,
    ep: 1,
    dp: 1,
    chipsPerReplica: 8,
    totalChips: 8,
    interNodeHops: 1,
    stages: [
      {
        id: 'qwen-a',
        label: 'Proposed node A · layers stage 1 · TP4',
        role: 'pipeline',
        chips: 4,
        rankStart: 0,
        rankEnd: 3,
      },
      {
        id: 'qwen-b',
        label: 'Proposed node B · layers stage 2 · TP4',
        role: 'pipeline',
        chips: 4,
        rankStart: 4,
        rankEnd: 7,
      },
    ],
    links: [
      {
        from: 'qwen-a',
        to: 'qwen-b',
        kind: 'activation',
        label: 'Pipeline activation transfer',
      },
    ],
    explanation:
      'One serving replica spans two proposed nodes: TP4 within each pipeline stage and PP2 between them. A second full replica would require another eight chips.',
    requirements: [
      'Verify model and quantization support for PP in the pinned serving runtime.',
      'Reserve eight compatible GPUs with topology-aware group scheduling.',
      'Benchmark activation transfer, pipeline bubbles, memory and tail latency.',
    ],
  },
  {
    id: 'kimi-tp8-pp2',
    model: 'kimi',
    name: 'Kimi · pipeline and expert groups',
    status: 'proposed',
    tp: 8,
    pp: 2,
    ep: 8,
    dp: 1,
    chipsPerReplica: 16,
    totalChips: 16,
    interNodeHops: 1,
    stages: [
      {
        id: 'kimi-a',
        label: 'Proposed group A · 2 × 4-chip hosts · TP8 / EP8 · stage 1',
        role: 'pipeline',
        chips: 8,
        rankStart: 0,
        rankEnd: 7,
      },
      {
        id: 'kimi-b',
        label: 'Proposed group B · 2 × 4-chip hosts · TP8 / EP8 · stage 2',
        role: 'pipeline',
        chips: 8,
        rankStart: 8,
        rankEnd: 15,
      },
    ],
    links: [
      {
        from: 'kimi-a',
        to: 'kimi-b',
        kind: 'activation',
        label: 'Pipeline activation transfer',
      },
    ],
    explanation:
      'Sixteen ranks across four modeled four-chip hosts form one proposed replica. Each pipeline stage spans two hosts and uses eight ranks; expert groups reuse those same ranks rather than adding eight more copies.',
    requirements: [
      'Kimi runtime support for this TP/PP/EP combination is unverified; treat as a design study.',
      'Validate expert balance and all-to-all bandwidth within each stage.',
      'Reserve the complete sixteen-chip group before admitting traffic.',
    ],
  },
  {
    id: 'qwen-pd',
    model: 'qwen',
    name: 'Qwen · disaggregated prefill / decode',
    status: 'proposed',
    tp: 4,
    pp: 1,
    ep: 1,
    dp: 1,
    chipsPerReplica: 4,
    totalChips: 8,
    interNodeHops: 1,
    stages: [
      {
        id: 'prefill',
        label: 'Prefill worker · complete model · TP4',
        role: 'prefill',
        chips: 4,
        rankStart: 0,
        rankEnd: 3,
      },
      {
        id: 'decode',
        label: 'Decode worker · complete model · TP4',
        role: 'decode',
        chips: 4,
        rankStart: 4,
        rankEnd: 7,
      },
    ],
    links: [
      {
        from: 'prefill',
        to: 'decode',
        kind: 'kv',
        label: 'KV state transfer via a compatible connector',
      },
    ],
    explanation:
      'Two separately resident model workers serve different phases of each request. This is not PP2: both workers need model weights. The eight-chip serving pair has no simulated latency or cost advantage.',
    requirements: [
      'Pin a model/runtime/quantization combination supported by the KV connector.',
      'Measure KV bytes, transfer time, cache locality, TTFT and inter-token latency.',
      'Scale prefill and decode independently only after measuring their queueing and memory pressure.',
    ],
  },
];
