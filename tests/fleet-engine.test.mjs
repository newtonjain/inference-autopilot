import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const e = require(
  path.join(
    process.env.SIM_BUILD_DIR || '/tmp/fleet-engine-check',
    'fleet-engine.js',
  ),
);

test('identical seed offers identical load independent of placement', () => {
  const w = e.defaultWorkload(),
    p = e.defaultProfile();
  const a = e.tickFleet(e.createFleetState(p, w), 90);
  const b = e.tickFleet(
    e.createFleetState(e.recommendProfiles(p, w)[1].profile, w),
    90,
  );
  assert.equal(a.arrivals, b.arrivals);
  assert.deepEqual(e.tickFleet(e.createFleetState(p, w), 90), a);
});
test('traffic is conserved including queued work and admission failures', () => {
  const w = { ...e.defaultWorkload(), rps: 300 };
  const s = e.tickFleet(e.createFleetState(e.defaultProfile(), w), 90);
  assert.ok(
    Math.abs(s.arrivals - s.completed - s.failed - e.summarize(s).queue) < 1e-7,
  );
  assert.ok(s.failed > 0);
  assert.equal(e.evaluateProfile(e.defaultProfile(), w).feasible, false);
});
test('cache and consolidation produce feasible measured synthetic alternatives', () => {
  const p = e.defaultProfile(),
    w = e.defaultWorkload(),
    cs = e.recommendProfiles(p, w);
  assert.ok(cs.every((c) => c.evaluation.feasible));
  const cost = cs.find((c) => c.goal === 'cost');
  assert.ok(
    cost.evaluation.summary.hourlyCost <
      e.summarize(e.createFleetState(p, w)).hourlyCost,
  );
  const uncached = {
    ...cs[0].profile,
    prefixCache: false,
    cacheAffinity: false,
  };
  assert.ok(
    e.evaluateProfile(uncached, w).summary.sloPassRate <
      cs[0].evaluation.summary.sloPassRate,
  );
});
test('Kimi requires eight GB300 chips; incompatible and overfull profiles fail', () => {
  assert.equal(e.MODELS.kimi.requiredChips, 8);
  assert.ok(e.MODELS.kimi.residentGB >= 1400);
  const p = e.defaultProfile();
  assert.ok(
    e.validateProfile({
      ...p,
      placements: [
        { id: 'bad', model: 'kimi', nodeId: 'tpuv7-a', replicas: 1 },
      ],
    }).length,
  );
  assert.ok(
    e.validateProfile({
      ...p,
      placements: [
        { id: 'bad', model: 'kimi', nodeId: 'gb300-a', replicas: 2 },
      ],
    }).length,
  );
  assert.equal(e.validateProfile(p).length, 0);
});
test('autoscaling warms before serving and remains within chip and slot bounds', () => {
  const w = { ...e.defaultWorkload(), rps: 500 };
  const p = e.defaultProfile();
  const first = e.tickFleet(e.createFleetState(p, w));
  const warming = first.replicas.filter((r) => r.status === 'warming');
  assert.ok(warming.length);
  assert.ok(
    warming.every(
      (r) => r.outputTokensPerSecond === 0 && r.readyAt > first.time,
    ),
  );
  const later = e.tickFleet(first, 90);
  assert.equal(e.validateProfile(later.profile).length, 0);
  assert.ok(
    later.replicas.some(
      (r) => warming.some((w) => w.id === r.id) && r.status === 'ready',
    ),
  );
  assert.ok(
    e.summarize(first).hourlyCost >=
      e.summarize(e.createFleetState(p, w)).hourlyCost,
  );
});
test('disabled autoscaling never allocates extra replicas', () => {
  const p = { ...e.defaultProfile(), autoscale: false },
    w = { ...e.defaultWorkload(), rps: 400 };
  const s = e.tickFleet(e.createFleetState(p, w), 90);
  assert.equal(s.replicas.length, 3);
  assert.equal(s.events.filter((x) => x.type === 'scale').length, 0);
});
test('profile switch preserves queued requests and lifetime counters', () => {
  const p = { ...e.defaultProfile(), autoscale: false },
    w = { ...e.defaultWorkload(), rps: 90 };
  const s = e.tickFleet(e.createFleetState(p, w), 20);
  const switched = e.applyFleetProfile(s, e.recommendProfiles(p, w)[0].profile);
  assert.equal(switched.arrivals, s.arrivals);
  assert.equal(switched.totalCost, s.totalCost);
  assert.equal(e.summarize(switched).queue, e.summarize(s).queue);
});
test('empty experiments cannot qualify a deployment', () => {
  assert.equal(
    e.evaluateProfile(e.defaultProfile(), { ...e.defaultWorkload(), rps: 0 })
      .feasible,
    false,
  );
});
