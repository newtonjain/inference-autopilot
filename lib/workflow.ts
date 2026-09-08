import { hash, simulate } from './simulator';
import type { Candidate, Config, Result, Settings, Trace } from './simulator';
export interface Proposal {
  id: string;
  contextHash: string;
  candidate: Candidate;
  state: 'proposed' | 'approved' | 'applied' | 'rejected';
}
export const contextHash = (trace: Trace, config: Config, settings: Settings) =>
  hash({ trace, config, settings });
export function propose(
  candidate: Candidate,
  trace: Trace,
  config: Config,
  settings: Settings,
): Proposal {
  if (!candidate.result.feasible)
    throw Error('This candidate did not pass the service targets.');
  if (candidate.result.traceHash !== hash(trace))
    throw Error('Experiment belongs to a different traffic trace.');
  return {
    id: hash({ candidate, trace, config, settings }),
    contextHash: contextHash(trace, config, settings),
    candidate,
    state: 'proposed',
  };
}
export function approveAndApply(
  proposal: Proposal,
  trace: Trace,
  current: Config,
  settings: Settings,
  applied: Set<string>,
): Result {
  if (proposal.state !== 'proposed')
    throw Error('Proposal is no longer available for approval.');
  if (applied.has(proposal.id))
    throw Error('This change has already been applied.');
  if (proposal.contextHash !== contextHash(trace, current, settings))
    throw Error('The deployment or workload changed. Run fresh experiments.');
  const verification = simulate(trace, proposal.candidate.config, settings);
  if (!verification.feasible)
    throw Error('Verification failed. The current configuration is unchanged.');
  applied.add(proposal.id);
  return verification;
}
