import {
  createFleetState,
  tickFleet,
  updateWorkload,
  summarize,
  MODEL_IDS,
} from './fleet-engine';
import type { FleetState, Summary } from './fleet-engine';
import { startRollout, tickRollout, rollbackRollout } from './fleet-rollout';
import type { Proposal, Rollout } from './fleet-rollout';
export interface FleetSession {
  fleet: FleetState;
  green: FleetState | null;
  rollout: Rollout | null;
}
export function liveRollout(r: Rollout | null) {
  return !!r && !['complete', 'rolled-back', 'failed'].includes(r.phase);
}
export function beginSessionRollout(
  session: FleetSession,
  proposal: Proposal,
  ids: Set<string>,
): FleetSession {
  if (liveRollout(session.rollout))
    throw Error('A rollout is already running.');
  const rollout = startRollout(
    proposal,
    session.fleet.profile,
    session.fleet.workload,
    ids,
  );
  const fleet = {
    ...session.fleet,
    profile: { ...session.fleet.profile, autoscale: false },
  };
  const green = createFleetState(
    { ...rollout.green, autoscale: false },
    { ...rollout.workload, rps: 0 },
    fleet.seed,
  );
  green.time = fleet.time;
  green.replicas = green.replicas.map((r) => ({
    ...r,
    status: 'warming',
    readyAt: fleet.time + 8,
  }));
  return { fleet, green, rollout };
}
function mergeAccounting(keep: FleetState, other: FleetState): FleetState {
  const merged = {
    ...keep,
    arrivals: keep.arrivals + other.arrivals,
    completed: keep.completed + other.completed,
    failed: keep.failed + other.failed,
    totalCost: keep.totalCost + other.totalCost,
    sloCompleted: keep.sloCompleted + other.sloCompleted,
    modelMetrics: structuredClone(keep.modelMetrics),
  };
  for (const m of MODEL_IDS) {
    merged.modelMetrics[m].completed += other.modelMetrics[m].completed;
    merged.modelMetrics[m].failed += other.modelMetrics[m].failed;
    merged.modelMetrics[m].queue += other.modelMetrics[m].queue;
  }
  return merged;
}
export function abortSessionRollout(
  session: FleetSession,
  reason = 'Operator requested rollback.',
): FleetSession {
  if (!liveRollout(session.rollout) || !session.green) return session;
  const rollout = rollbackRollout(session.rollout!, reason);
  const fleet = updateWorkload(
    mergeAccounting(session.fleet, session.green),
    rollout.workload,
  );
  fleet.profile = { ...rollout.blue };
  return { fleet, green: null, rollout };
}
function poolWorkload(state: FleetState, rollout: Rollout, share: number) {
  // concurrency is the fleet-wide admission/queue budget, split at the router.
  // Preserve already-admitted backlog while a pool drains; this allowance cannot
  // grow its old queue and avoids dropping requests merely because share fell.
  const mixTotal =
    MODEL_IDS.reduce((n, m) => n + rollout.workload.mix[m], 0) || 1;
  const retainedBudget = Math.max(
    0,
    ...MODEL_IDS.map((m) =>
      rollout.workload.mix[m] > 0
        ? (state.modelMetrics[m].queue * mixTotal) / rollout.workload.mix[m]
        : 0,
    ),
  );
  return {
    ...rollout.workload,
    rps: rollout.workload.rps * share,
    concurrency: Math.max(
      1,
      rollout.workload.concurrency * share,
      retainedBudget,
    ),
  };
}
function liveGreenFailures(green: FleetState, rollout: Rollout): string[] {
  const reasons: string[] = [];
  if (green.arrivals <= 0) return ['No live green traffic was observed.'];
  if (green.failed / green.arrivals > 0.01)
    reasons.push('More than 1% of live green requests were rejected.');
  if (green.sloCompleted / green.arrivals < 0.95)
    reasons.push(
      'Fewer than 95% of live green requests completed within the latency targets.',
    );
  for (const model of MODEL_IDS)
    if (rollout.workload.mix[model] > 0) {
      const metrics = green.modelMetrics[model];
      if (metrics.ttftMs > rollout.workload.ttftTargetMs)
        reasons.push(`${model} live TTFT exceeds target.`);
      if (metrics.tokenMs > rollout.workload.tokenTargetMs)
        reasons.push(`${model} live token latency exceeds target.`);
    }
  return reasons;
}
export function tickSession(session: FleetSession): FleetSession {
  if (!liveRollout(session.rollout) || !session.green)
    return { ...session, fleet: tickFleet(session.fleet) };
  const rollout = tickRollout(session.rollout!);
  // Finish observing the 10% canary before the controller's next traffic step.
  const enteringMigration =
    session.rollout!.phase === 'canary' && rollout.phase === 'migrating';
  const share =
    (enteringMigration ? session.rollout!.greenTraffic : rollout.greenTraffic) /
    100;
  if (enteringMigration) rollout.greenTraffic = share * 100;
  const fleet = tickFleet(
    updateWorkload(
      session.fleet,
      poolWorkload(session.fleet, rollout, 1 - share),
    ),
  );
  const green = tickFleet(
    updateWorkload(session.green, poolWorkload(session.green, rollout, share)),
  );
  const next = { fleet, green, rollout };
  if (rollout.phase === 'rolled-back' || rollout.phase === 'failed') {
    const restored = updateWorkload(
      mergeAccounting(fleet, green),
      rollout.workload,
    );
    restored.profile = { ...rollout.blue };
    return { fleet: restored, green: null, rollout };
  }
  if (
    (session.rollout!.phase === 'canary' && rollout.phase === 'migrating') ||
    (session.rollout!.phase === 'verifying' && rollout.phase === 'draining')
  ) {
    const failures = liveGreenFailures(green, rollout);
    if (failures.length)
      return abortSessionRollout(
        next,
        `Live green gate failed: ${failures.join(' ')}`,
      );
  }
  if (rollout.phase === 'complete') {
    if (summarize(fleet).queue > 0.001)
      return abortSessionRollout(
        {
          ...next,
          rollout: {
            ...rollout,
            phase: 'draining',
            events: rollout.events.filter(
              (event) => event.phase !== 'complete',
            ),
          },
        },
        'Blue still has queued work at the drain gate. Restore blue and retain pending requests.',
      );
    const active = updateWorkload(
      mergeAccounting(green, fleet),
      rollout.workload,
    );
    active.profile = { ...rollout.green };
    return { fleet: active, green: null, rollout };
  }
  return next;
}
export function sessionSummary(s: FleetSession): Summary {
  const blue = summarize(s.fleet);
  if (!s.green) return blue;
  const green = summarize(s.green);
  const share = (s.rollout?.greenTraffic || 0) / 100;
  const arrivals = s.fleet.arrivals + s.green.arrivals;
  return {
    hourlyCost: blue.hourlyCost + green.hourlyCost,
    outputTokensPerSecond:
      blue.outputTokensPerSecond + green.outputTokensPerSecond,
    ttftMs: blue.ttftMs * (1 - share) + green.ttftMs * share,
    sloPassRate: arrivals
      ? (s.fleet.sloCompleted + s.green.sloCompleted) / arrivals
      : 0,
    utilization:
      (blue.utilization * blue.readyReplicas +
        green.utilization * green.readyReplicas) /
      Math.max(1, blue.readyReplicas + green.readyReplicas),
    queue: blue.queue + green.queue,
    activeReplicas: blue.activeReplicas + green.activeReplicas,
    readyReplicas: blue.readyReplicas + green.readyReplicas,
  };
}
