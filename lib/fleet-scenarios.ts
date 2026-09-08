import { defaultProfile, defaultWorkload } from './fleet-engine';
import type { FleetProfile, WorkloadConfig } from './fleet-engine';
export interface DemoScenario {
  id: string;
  title: string;
  thesis: string;
  steps: string;
  candidate: string;
  profile: FleetProfile;
  workload: WorkloadConfig;
}
export function demoScenarios(): DemoScenario[] {
  const base = defaultWorkload();
  const profile = () => ({ ...defaultProfile(), autoscale: false });
  return [
    {
      id: 'prefix',
      title: 'Shared-prefix rescue',
      thesis: 'Restore latency without adding hardware.',
      steps:
        'Run optimization → inspect Cache-aware serving → approve. Watch traffic move to the cache-aware pool.',
      candidate: 'Cache-aware serving',
      profile: profile(),
      workload: {
        ...base,
        inputTokens: 3500,
        outputTokens: 220,
        sharedPrefix: 0.9,
        burstiness: 0.1,
      },
    },
    {
      id: 'offpeak',
      title: 'Off-peak consolidation',
      thesis: 'Retire idle capacity while preserving the latency targets.',
      steps:
        'Run optimization → inspect Consolidate GPU footprint → approve. Compare steady-state savings with temporary overlap cost.',
      candidate: 'Consolidate GPU footprint',
      profile: profile(),
      workload: { ...base, rps: 12 },
    },
    {
      id: 'qwen',
      title: 'Qwen launch spike',
      thesis:
        'Reject cheap profiles that cannot keep up; reserve capacity before the spike.',
      steps:
        'Run optimization → inspect the rejected cheaper profiles → approve Burst-ready elastic fleet. Or enable autoscaling and Run to observe reactive warmups.',
      candidate: 'Burst-ready elastic fleet',
      profile: profile(),
      workload: {
        ...base,
        rps: 27,
        mix: { gemma: 0.25, qwen: 0.5, kimi: 0.25 },
      },
    },
  ];
}
