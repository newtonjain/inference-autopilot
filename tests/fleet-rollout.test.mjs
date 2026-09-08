import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const engine = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'fleet-engine.js')).href
  )
).default;
const {
  proposeFleetChange,
  startRollout,
  tickRollout,
  rollbackRollout,
  ROLLOUT_CAPACITY_NOTE,
} = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'fleet-rollout.js')).href
  )
).default;
// A deliberately light but nonzero workload isolates rollout policy from overload.
const workload = {
  rps: 0.5,
  inputTokens: 256,
  outputTokens: 32,
  sharedPrefix: 0.5,
  burstiness: 0,
  concurrency: 32,
  ttftTargetMs: 10000,
  tokenTargetMs: 1000,
  mix: { gemma: 0.4, qwen: 0.3, kimi: 0.3 },
};
function fixtures() {
  const blue = engine.defaultProfile();
  const green = {
    ...structuredClone(blue),
    id: 'rollout-test-green',
    name: 'Green test',
    prefixCache: true,
    cacheAffinity: true,
  };
  const proposal = proposeFleetChange(blue, green, workload, [
    'Enable prefix reuse.',
  ]);
  assert.equal(
    proposal.status,
    'proposed',
    proposal.evidenceEvaluation.reasons.join(' '),
  );
  return { blue, green, proposal };
}
function approvedStart() {
  const { blue, proposal } = fixtures();
  return startRollout(
    { ...proposal, status: 'approved' },
    blue,
    workload,
    new Set(),
  );
}
test('rollout requires explicit approval and binds every workload and placement setting', () => {
  const { blue, proposal } = fixtures();
  assert.throws(
    () => startRollout(proposal, blue, workload, new Set()),
    /approval/,
  );
  const approved = { ...proposal, status: 'approved' };
  assert.throws(
    () =>
      startRollout(
        approved,
        blue,
        { ...workload, inputTokens: 257 },
        new Set(),
      ),
    /changed/,
  );
  assert.throws(
    () =>
      startRollout(
        approved,
        { ...blue, batchConcurrency: blue.batchConcurrency + 1 },
        workload,
        new Set(),
      ),
    /changed/,
  );
  assert.throws(
    () =>
      startRollout(
        { ...approved, green: { ...approved.green, headroom: 0.7 } },
        blue,
        workload,
        new Set(),
      ),
    /changed/,
  );
  const ids = new Set();
  startRollout(approved, blue, workload, ids);
  assert.throws(() => startRollout(approved, blue, workload, ids), /already/);
});
test('blue-green rollout warms before traffic and retains blue through verification', () => {
  let rollout = approvedStart();
  assert.equal(rollout.greenTraffic, 0);
  rollout = tickRollout(rollout, 7);
  assert.equal(rollout.phase, 'warming');
  assert.equal(rollout.greenTraffic, 0);
  rollout = tickRollout(rollout, 1);
  assert.equal(rollout.phase, 'canary');
  assert.equal(rollout.greenTraffic, 10);
  rollout = tickRollout(rollout, 8);
  assert.equal(rollout.phase, 'migrating');
  assert.equal(rollout.greenTraffic, 25);
  rollout = tickRollout(rollout, 3);
  assert.equal(rollout.greenTraffic, 50);
  rollout = tickRollout(rollout, 7);
  assert.equal(rollout.phase, 'verifying');
  assert.equal(rollout.greenTraffic, 100);
  assert.equal(rollout.verificationPassed, false);
  rollout = tickRollout(rollout, 6);
  assert.equal(rollout.phase, 'draining');
  assert.equal(rollout.verificationPassed, true);
  rollout = tickRollout(rollout, 5);
  assert.equal(rollout.phase, 'complete');
  assert.equal(rollout.elapsed, 37);
});
test('temporary capacity is explicit and both pools accrue overlap cost exactly once', () => {
  const start = approvedStart();
  assert.match(ROLLOUT_CAPACITY_NOTE, /separate temporary copy/);
  const done = tickRollout(start, 100);
  assert.ok(
    Math.abs(
      done.overlapCost -
        ((start.blueEvaluation.summary.hourlyCost +
          start.greenEvaluation.summary.hourlyCost) *
          37) /
          3600,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      done.surgeCost - (start.greenEvaluation.summary.hourlyCost * 37) / 3600,
    ) < 1e-10,
  );
  assert.deepEqual(tickRollout(done, 100), done);
  assert.equal(start.overlapCost, 0);
});
test('rollback returns all traffic to blue and releases temporary capacity', () => {
  const migration = tickRollout(approvedStart(), 20);
  const restored = rollbackRollout(
    migration,
    'Operator rejected observed behavior.',
  );
  assert.equal(restored.phase, 'rolled-back');
  assert.equal(restored.greenTraffic, 0);
  assert.equal(restored.verificationPassed, false);
  assert.deepEqual(tickRollout(restored, 100), restored);
  assert.match(restored.events.at(-1).message, /released/);
});
test('rollout snapshots workload and is deterministic across tick sizes', () => {
  const start = approvedStart();
  const direct = tickRollout(start, 37);
  let incremental = start;
  for (let i = 0; i < 37; i++) incremental = tickRollout(incremental);
  assert.equal(incremental.phase, direct.phase);
  assert.deepEqual(incremental.events, direct.events);
  assert.ok(Math.abs(incremental.overlapCost - direct.overlapCost) < 1e-10);
  assert.notEqual(start.workload, workload);
  assert.throws(() => tickRollout(start, -1), /duration/);
  assert.throws(() => tickRollout(start, Infinity), /duration/);
});
test('a failing full-load candidate is rejected before traffic migration', () => {
  const { blue, green } = fixtures();
  const overloaded = {
    ...workload,
    rps: 100000,
    concurrency: 100000,
    ttftTargetMs: 1,
  };
  const proposal = proposeFleetChange(blue, green, overloaded, [
    'An unsafe test.',
  ]);
  assert.equal(proposal.status, 'rejected');
  assert.throws(
    () =>
      startRollout(
        { ...proposal, status: 'approved' },
        blue,
        overloaded,
        new Set(),
      ),
    /gate failed/,
  );
});
test('approval evidence uses fixed prescribed capacity even when autoscale is enabled', () => {
  const { blue, green } = fixtures();
  const candidate = { ...green, autoscale: true };
  const proposal = proposeFleetChange(blue, candidate, workload, [
    'Evaluate fixed rollout capacity.',
  ]);
  assert.deepEqual(
    proposal.evidenceEvaluation,
    engine.evaluateProfile({ ...candidate, autoscale: false }, workload),
  );
});
