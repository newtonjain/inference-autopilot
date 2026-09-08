import {
  MODEL_IDS,
  createFleetState,
  evaluateProfile,
  recommendProfiles,
  validateProfile,
  type Evaluation,
  type FleetProfile,
  type WorkloadConfig,
} from './fleet-engine';

export interface SweepCandidate {
  id: string;
  profile: FleetProfile;
  reason: string;
  prescription: string[];
  goal: 'latency' | 'cost' | 'throughput';
  evaluation: Evaluation;
  pareto: boolean;
}
export interface ConfigurationSweep {
  candidates: SweepCandidate[];
  shortlist: SweepCandidate[];
  evaluatedCount: number;
  feasibleCount: number;
  scope: string;
  replaySeconds: 90;
  seed: 42;
}

function assertWorkload(workload: WorkloadConfig) {
  const normalized = createFleetState(undefined, workload).workload;
  for (const key of Object.keys(normalized) as (keyof WorkloadConfig)[]) {
    if (
      key !== 'mix' &&
      (!Number.isFinite(workload[key]) || normalized[key] !== workload[key])
    )
      throw new Error(
        `Workload ${key} is outside the simulation's supported range.`,
      );
  }
  if (
    workload.rps <= 0 ||
    MODEL_IDS.some(
      (id) => !Number.isFinite(workload.mix[id]) || workload.mix[id] < 0,
    ) ||
    MODEL_IDS.reduce((sum, id) => sum + workload.mix[id], 0) <= 0
  )
    throw new Error(
      'A sweep requires positive traffic and a finite, nonnegative model mix.',
    );
}

function placementKey(profile: FleetProfile) {
  return JSON.stringify(
    profile.placements
      .map(({ model, nodeId, replicas }) => ({ model, nodeId, replicas }))
      .sort((a, b) =>
        `${a.model}:${a.nodeId}:${a.replicas}`.localeCompare(
          `${b.model}:${b.nodeId}:${b.replicas}`,
        ),
      ),
  );
}

function dominates(a: SweepCandidate, b: SweepCandidate) {
  const x = a.evaluation.summary,
    y = b.evaluation.summary;
  return (
    a.evaluation.feasible &&
    b.evaluation.feasible &&
    x.hourlyCost <= y.hourlyCost &&
    x.ttftMs <= y.ttftMs &&
    x.outputTokensPerSecond >= y.outputTokensPerSecond &&
    (x.hourlyCost < y.hourlyCost ||
      x.ttftMs < y.ttftMs ||
      x.outputTokensPerSecond > y.outputTokensPerSecond)
  );
}

/** Exhaustive only within this small declared grid, never a global optimum claim. */
export function sweepConfiguration(
  profile: FleetProfile,
  workload: WorkloadConfig,
): ConfigurationSweep {
  const errors = validateProfile(profile);
  if (errors.length) throw new Error(errors.join(' '));
  assertWorkload(workload);
  const strategies = recommendProfiles(profile, workload);
  const layouts = strategies.filter(
    (candidate, index) =>
      strategies.findIndex(
        (other) =>
          placementKey(other.profile) === placementKey(candidate.profile),
      ) === index,
  );
  const candidates: SweepCandidate[] = [];
  for (const [layoutIndex, layout] of layouts.entries()) {
    for (const batchConcurrency of [8, 16, 32, 64]) {
      for (const [cacheIndex, [prefixCache, cacheAffinity]] of [
        [false, false],
        [true, false],
        [true, true],
      ].entries()) {
        const id = `sweep-${layoutIndex}-${batchConcurrency}-${cacheIndex}`;
        const candidateProfile: FleetProfile = {
          ...structuredClone(layout.profile),
          id,
          name: `${layout.profile.name} · batch ${batchConcurrency} · ${!prefixCache ? 'no cache' : cacheAffinity ? 'cache + affinity' : 'cache'}`,
          prefixCache,
          cacheAffinity,
          batchConcurrency,
          headroom: profile.headroom,
          autoscale: false,
        };
        candidates.push({
          id,
          profile: candidateProfile,
          goal: layout.goal,
          pareto: false,
          reason: `${layout.reason} Compare ${batchConcurrency}-way batching with ${!prefixCache ? 'cache disabled' : cacheAffinity ? 'prefix reuse and cache-affinity routing' : 'prefix reuse without affinity'} against the same captured demand.`,
          prescription: [
            `Use placement layout: ${candidateProfile.placements.map((p) => `${p.replicas} ${p.model} replica(s) on ${p.nodeId}`).join('; ')}.`,
            `Set batch concurrency to ${batchConcurrency}; prefix cache ${prefixCache ? 'on' : 'off'}; cache affinity ${cacheAffinity ? 'on' : 'off'}.`,
            'Disable reactive autoscaling to compare fixed capacity in a 90-second, seed-42 synthetic replay.',
            `Retain headroom ${(profile.headroom * 100).toFixed(0)}%; it does not affect this frozen-capacity experiment.`,
          ],
          evaluation: evaluateProfile(candidateProfile, workload, 90, 42),
        });
      }
    }
  }
  for (const candidate of candidates)
    candidate.pareto =
      candidate.evaluation.feasible &&
      !candidates.some((other) => dominates(other, candidate));
  candidates.sort(
    (a, b) =>
      Number(b.evaluation.feasible) - Number(a.evaluation.feasible) ||
      (a.evaluation.feasible
        ? a.evaluation.summary.hourlyCost - b.evaluation.summary.hourlyCost
        : b.evaluation.summary.sloPassRate -
          a.evaluation.summary.sloPassRate) ||
      a.evaluation.summary.ttftMs - b.evaluation.summary.ttftMs ||
      b.evaluation.summary.outputTokensPerSecond -
        a.evaluation.summary.outputTokensPerSecond ||
      a.id.localeCompare(b.id),
  );
  const shortlist: SweepCandidate[] = [];
  // Include the leading option for every placement strategy, then Pareto alternatives.
  for (const layout of layouts) {
    const best = candidates.find(
      (c) => placementKey(c.profile) === placementKey(layout.profile),
    );
    if (best) shortlist.push(best);
  }
  for (const candidate of [
    ...candidates.filter((c) => c.pareto),
    ...candidates,
  ]) {
    if (shortlist.length >= 6) break;
    if (!shortlist.includes(candidate)) shortlist.push(candidate);
  }
  shortlist.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  return {
    candidates,
    shortlist,
    evaluatedCount: candidates.length,
    feasibleCount: candidates.filter((c) => c.evaluation.feasible).length,
    replaySeconds: 90,
    seed: 42,
    scope: `${layouts.length} distinct placement layouts (baseline, consolidation, pre-reserved capacity where distinct) × 4 batch limits (8/16/32/64) × 3 valid cache modes. All ${candidates.length} grid points replayed for 90 simulated seconds with seed 42. Autoscaling is disabled; headroom is retained, not swept, because it has no effect while scaling is frozen. Ranking prioritizes passing latency/rejection gates, then active-node cost and TTFT. The shortlist includes placement diversity and nondominated cost/latency/throughput alternatives. Hardware, traffic, prices and performance are synthetic; this is not a global search or a production benchmark.`,
  };
}

/** Compact structured evidence for a model: no raw prompts, request bodies or traces. */
export function summarizeSweepForModel(sweep: ConfigurationSweep) {
  return {
    scope: sweep.scope,
    evaluatedCount: sweep.evaluatedCount,
    feasibleCount: sweep.feasibleCount,
    candidates: sweep.candidates.map((candidate) => ({
      id: candidate.id,
      profile: {
        placements: candidate.profile.placements.map(
          ({ model, nodeId, replicas }) => ({ model, nodeId, replicas }),
        ),
        prefixCache: candidate.profile.prefixCache,
        cacheAffinity: candidate.profile.cacheAffinity,
        batchConcurrency: candidate.profile.batchConcurrency,
        headroom: candidate.profile.headroom,
        autoscale: candidate.profile.autoscale,
      },
      feasible: candidate.evaluation.feasible,
      gateFailures: candidate.evaluation.reasons,
      metrics: candidate.evaluation.summary,
      completed: candidate.evaluation.completed,
      rejected: candidate.evaluation.failed,
      pareto: candidate.pareto,
    })),
  };
}
