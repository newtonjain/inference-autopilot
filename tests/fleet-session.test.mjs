import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const e = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'fleet-engine.js')).href
  )
).default;
const r = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'fleet-rollout.js')).href
  )
).default;
const s = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'fleet-session.js')).href
  )
).default;
function setup() {
  const fleet = e.createFleetState();
  const option = e
    .recommendProfiles(fleet.profile, fleet.workload)
    .find((c) => c.profile.id === 'consolidated');
  const proposal = r.proposeFleetChange(
    fleet.profile,
    option.profile,
    fleet.workload,
    option.prescription,
  );
  return s.beginSessionRollout(
    { fleet, green: null, rollout: null },
    { ...proposal, status: 'approved' },
    new Set(),
  );
}
test('traffic actually enters independent blue and green pools and maintains offered demand', () => {
  let session = setup();
  let expected = 0;
  let source = e.createFleetState();
  let sawSplit = false;
  for (let t = 0; t < 37; t++) {
    source = e.tickFleet(source);
    expected = source.arrivals;
    session = s.tickSession(session);
    const total = session.fleet.arrivals + (session.green?.arrivals || 0);
    assert.ok(Math.abs(total - expected) < 1e-6);
    if (
      session.green &&
      session.rollout.greenTraffic > 0 &&
      session.rollout.greenTraffic < 100
    ) {
      sawSplit = true;
      assert.ok(session.green.arrivals > 0);
    }
  }
  assert.ok(sawSplit);
  assert.equal(session.rollout.phase, 'complete');
  assert.equal(session.green, null);
  assert.equal(session.fleet.profile.id, 'consolidated');
});
test('warming green gets no requests and ready capacity is bounded', () => {
  let session = setup();
  for (let i = 0; i < 7; i++) {
    session = s.tickSession(session);
    assert.equal(session.green.arrivals, 0);
    assert.ok(session.green.replicas.every((r) => r.status === 'warming'));
  }
  session = s.tickSession(session);
  assert.ok(session.green.replicas.every((r) => r.status === 'ready'));
  assert.ok(session.green.arrivals > 0);
});
test('rollback preserves offered work and charges both pools', () => {
  let session = setup();
  for (let i = 0; i < 20; i++) session = s.tickSession(session);
  const total = session.fleet.arrivals + session.green.arrivals;
  const cost = session.fleet.totalCost + session.green.totalCost;
  session = s.abortSessionRollout(session);
  assert.equal(session.green, null);
  assert.equal(session.rollout.phase, 'rolled-back');
  assert.ok(Math.abs(session.fleet.arrivals - total) < 1e-6);
  assert.ok(Math.abs(session.fleet.totalCost - cost) < 1e-6);
  assert.equal(session.fleet.workload.rps, 24);
});
test('live green canary failure rolls back even when offline replay passed', () => {
  let session = setup();
  for (let i = 0; i < 15; i++) session = s.tickSession(session);
  assert.equal(session.rollout.phase, 'canary');
  session.green.replicas = session.green.replicas.map((replica) => ({
    ...replica,
    status: 'warming',
    readyAt: 10000,
  }));
  const priorArrivals = session.fleet.arrivals + session.green.arrivals;
  session = s.tickSession(session);
  assert.equal(session.rollout.phase, 'rolled-back');
  assert.match(session.rollout.reason, /Live green gate failed/);
  assert.equal(session.green, null);
  assert.ok(session.fleet.arrivals > priorArrivals);
  assert.ok(
    Math.abs(
      session.fleet.arrivals -
        session.fleet.failed -
        session.fleet.completed -
        e.summarize(session.fleet).queue,
    ) < 1e-6,
  );
});
test('live verification detects green failures before blue drains', () => {
  let session = setup();
  for (let i = 0; i < 31; i++) session = s.tickSession(session);
  assert.equal(session.rollout.phase, 'verifying');
  session.green.replicas = session.green.replicas.map((replica) => ({
    ...replica,
    status: 'warming',
    readyAt: 10000,
  }));
  session = s.tickSession(session);
  assert.equal(session.rollout.phase, 'rolled-back');
  assert.equal(session.rollout.verificationPassed, false);
  assert.match(session.rollout.reason, /Live green gate failed/);
});
test('router splits the fleet queue budget between blue and green', () => {
  let session = setup();
  for (let i = 0; i < 9; i++) session = s.tickSession(session);
  assert.equal(session.rollout.greenTraffic, 10);
  assert.ok(
    Math.abs(
      session.fleet.workload.concurrency -
        session.rollout.workload.concurrency * 0.9,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      session.green.workload.concurrency -
        session.rollout.workload.concurrency * 0.1,
    ) < 1e-8,
  );
});
test('failed drain preserves the final tick of costs and all pending work', () => {
  let session = setup();
  for (let i = 0; i < 36; i++) session = s.tickSession(session);
  assert.equal(session.rollout.phase, 'draining');
  session.fleet.modelMetrics.gemma.queue = 100;
  session.fleet.replicas = session.fleet.replicas.map((replica) => ({
    ...replica,
    status: 'warming',
    readyAt: 10000,
  }));
  const previousCost = session.fleet.totalCost + session.green.totalCost;
  const hourly =
    e.summarize(session.fleet).hourlyCost +
    e.summarize(session.green).hourlyCost;
  const previousOverlap = session.rollout.overlapCost;
  session = s.tickSession(session);
  assert.equal(session.rollout.phase, 'rolled-back');
  assert.equal(session.rollout.elapsed, 37);
  assert.ok(
    Math.abs(session.fleet.totalCost - previousCost - hourly / 3600) < 1e-9,
  );
  assert.ok(
    Math.abs(session.rollout.overlapCost - previousOverlap - hourly / 3600) <
      1e-9,
  );
  assert.equal(session.fleet.modelMetrics.gemma.queue, 100);
  assert.ok(
    !session.rollout.events.some((event) => event.phase === 'complete'),
  );
  assert.equal(session.rollout.events.at(-1).time, 37);
});
