import { evaluateProfile, validateProfile } from './fleet-engine';
import type { Evaluation, FleetProfile, WorkloadConfig } from './fleet-engine';

export type RolloutPhase =
  | 'warming'
  | 'canary'
  | 'migrating'
  | 'verifying'
  | 'draining'
  | 'complete'
  | 'rolled-back'
  | 'failed';
export interface Proposal {
  id: string;
  contextHash: string;
  blue: FleetProfile;
  green: FleetProfile;
  evidenceEvaluation: Evaluation;
  prescription: string[];
  status: 'proposed' | 'approved' | 'rejected';
}
export interface Rollout {
  id: string;
  blue: FleetProfile;
  green: FleetProfile;
  workload: WorkloadConfig;
  phase: RolloutPhase;
  elapsed: number;
  phaseElapsed: number;
  greenTraffic: number;
  events: { time: number; phase: RolloutPhase; message: string }[];
  /** Total simulated compute spend while blue and green coexist. */
  overlapCost: number;
  /** Incremental green-pool spend during the overlap, included in overlapCost. */
  surgeCost: number;
  blueEvaluation: Evaluation;
  greenEvaluation: Evaluation;
  verificationPassed: boolean;
  reason?: string;
}

/** No real capacity is provisioned. Green uses a separate, temporary copy of its
 * validated inventory placements, never free slots on the live blue nodes.
 * validateProfile bounds a candidate to the base inventory, so the temporary
 * pool is bounded to at most one additional full inventory. Both pools are
 * billed during warmup, migration, verification, and blue draining. Timing is
 * accelerated simulation, not a prediction of cloud/model startup times. */
export const ROLLOUT_CAPACITY_NOTE =
  'Simulated surge pool: green receives a separate temporary copy of its required nodes, capped at one extra fleet inventory. Blue + green compute is billed throughout the overlap. Autoscaling is paused during rollout; gates use the prescribed fixed capacity. Startup and drain times are accelerated.';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function fingerprint(value: unknown): string {
  const serialized = canonical(value);
  let h = 2166136261;
  for (let i = 0; i < serialized.length; i++)
    h = Math.imul(h ^ serialized.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
export function fleetContextHash(
  current: FleetProfile,
  workload: WorkloadConfig,
): string {
  // Exact canonical context avoids hash-collision approval ambiguity.
  return canonical({ current, workload });
}
function proposalId(proposal: Omit<Proposal, 'id' | 'status'>): string {
  return `proposal-${fingerprint(proposal)}`;
}
function rolloutEvaluation(
  profile: FleetProfile,
  workload: WorkloadConfig,
): Evaluation {
  // Admission must succeed on prescribed capacity, not replicas created later.
  // The UI runs fixed pools during rollout and restores autoscale on completion.
  return evaluateProfile({ ...profile, autoscale: false }, workload);
}
function gate(profile: FleetProfile, evidence: Evaluation): string[] {
  const reasons = [...validateProfile(profile)];
  if (!evidence.feasible)
    reasons.push(
      ...evidence.reasons,
      'Candidate does not satisfy the workload service targets.',
    );
  if (!(evidence.completed > 0))
    reasons.push('No completed requests: insufficient evidence.');
  if (
    !Number.isFinite(evidence.summary.hourlyCost) ||
    evidence.summary.hourlyCost < 0
  )
    reasons.push('Invalid compute cost.');
  return [...new Set(reasons)];
}
export function proposeFleetChange(
  blue: FleetProfile,
  green: FleetProfile,
  workload: WorkloadConfig,
  prescription: string[],
): Proposal {
  const evidenceEvaluation = rolloutEvaluation(green, workload);
  const content = {
    contextHash: fleetContextHash(blue, workload),
    blue: clone(blue),
    green: clone(green),
    evidenceEvaluation,
    prescription: [...prescription],
  };
  return {
    ...content,
    id: proposalId(content),
    status: gate(green, evidenceEvaluation).length ? 'rejected' : 'proposed',
  };
}
export function startRollout(
  proposal: Proposal,
  current: FleetProfile,
  workload: WorkloadConfig,
  appliedIds: Set<string>,
): Rollout {
  if (appliedIds.has(proposal.id))
    throw Error('This proposal has already started a rollout.');
  if (proposal.status !== 'approved')
    throw Error('Explicit approval is required before starting a rollout.');
  if (proposal.contextHash !== fleetContextHash(current, workload))
    throw Error(
      'Deployment or workload changed. Run fresh experiments and approve again.',
    );
  const { id, status: _status, ...content } = proposal;
  if (
    proposalId(content) !== id ||
    canonical(proposal.blue) !== canonical(current)
  )
    throw Error('Proposal changed after evaluation. Run fresh experiments.');
  const blueErrors = validateProfile(current);
  if (blueErrors.length)
    throw Error(`Invalid active profile: ${blueErrors.join(' ')}`);
  const greenEvaluation = rolloutEvaluation(proposal.green, workload);
  const reasons = gate(proposal.green, greenEvaluation);
  if (reasons.length) throw Error(`Rollout gate failed: ${reasons.join(' ')}`);
  const blueEvaluation = rolloutEvaluation(current, workload);
  appliedIds.add(proposal.id);
  return {
    id: proposal.id,
    blue: clone(current),
    green: clone(proposal.green),
    workload: clone(workload),
    phase: 'warming',
    elapsed: 0,
    phaseElapsed: 0,
    greenTraffic: 0,
    events: [{ time: 0, phase: 'warming', message: ROLLOUT_CAPACITY_NOTE }],
    overlapCost: 0,
    surgeCost: 0,
    blueEvaluation,
    greenEvaluation,
    verificationPassed: false,
  };
}
const DURATIONS: Partial<Record<RolloutPhase, number>> = {
  warming: 8,
  canary: 8,
  migrating: 10,
  verifying: 6,
  draining: 5,
};
function event(rollout: Rollout, phase: RolloutPhase, message: string): void {
  rollout.phase = phase;
  rollout.phaseElapsed = 0;
  rollout.events.push({ time: rollout.elapsed, phase, message });
}
export function rollbackRollout(rollout: Rollout, reason: string): Rollout {
  if (['complete', 'rolled-back', 'failed'].includes(rollout.phase))
    return clone(rollout);
  const next = clone(rollout);
  next.greenTraffic = 0;
  next.verificationPassed = false;
  next.reason = reason;
  event(
    next,
    'rolled-back',
    `${reason} Traffic returned to blue; simulated temporary green pool released.`,
  );
  return next;
}
export function tickRollout(rollout: Rollout, seconds = 1): Rollout {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw Error('Rollout tick must be a finite non-negative duration.');
  const next = clone(rollout);
  let remaining = seconds;
  while (remaining > 0 && DURATIONS[next.phase] !== undefined) {
    const duration = DURATIONS[next.phase]!;
    const step = Math.min(remaining, duration - next.phaseElapsed);
    next.elapsed += step;
    next.phaseElapsed += step;
    next.overlapCost +=
      ((next.blueEvaluation.summary.hourlyCost +
        next.greenEvaluation.summary.hourlyCost) *
        step) /
      3600;
    next.surgeCost += (next.greenEvaluation.summary.hourlyCost * step) / 3600;
    remaining -= step;
    if (next.phase === 'migrating')
      next.greenTraffic =
        next.phaseElapsed < 3 ? 25 : next.phaseElapsed < 7 ? 50 : 100;
    if (next.phaseElapsed < duration) break;
    if (next.phase === 'warming') {
      const reasons = gate(
        next.green,
        rolloutEvaluation(next.green, next.workload),
      );
      if (reasons.length)
        return rollbackRollout(
          next,
          `Readiness gate failed: ${reasons.join(' ')}`,
        );
      next.greenTraffic = 10;
      event(
        next,
        'canary',
        'Green readiness passed. Route 10% to green; retain 90% on blue.',
      );
    } else if (next.phase === 'canary') {
      // Full-load evidence is deliberately conservative: partial canary traffic
      // cannot hide a candidate that fails once it receives the whole workload.
      const reasons = gate(
        next.green,
        rolloutEvaluation(next.green, next.workload),
      );
      if (reasons.length)
        return rollbackRollout(
          next,
          `Canary gate failed: ${reasons.join(' ')}`,
        );
      next.greenTraffic = 25;
      event(
        next,
        'migrating',
        'Canary gate passed against full-load replay. Migrate traffic 25% → 50% → 100%.',
      );
    } else if (next.phase === 'migrating') {
      next.greenTraffic = 100;
      event(
        next,
        'verifying',
        'Green serves 100%. Verify the locked workload against the same service targets.',
      );
    } else if (next.phase === 'verifying') {
      next.greenEvaluation = rolloutEvaluation(next.green, next.workload);
      const reasons = gate(next.green, next.greenEvaluation);
      if (reasons.length)
        return rollbackRollout(
          next,
          `Verification failed: ${reasons.join(' ')}`,
        );
      next.verificationPassed = true;
      event(
        next,
        'draining',
        'Verification passed. Drain blue while retaining rollback capacity.',
      );
    } else if (next.phase === 'draining') {
      event(
        next,
        'complete',
        'Blue drained and released. Green is active; ongoing spend is now the green profile cost.',
      );
    }
  }
  return next;
}
