import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const build = process.env.SIM_BUILD_DIR || '/tmp/fleet-engine-check';
const engine = require(path.join(build, 'fleet-engine.js'));
const { sweepConfiguration, summarizeSweepForModel } = require(
  path.join(build, 'config-sweep.js'),
);

test('sweep exhausts declared bounded grid and uses exact fixed-profile evidence', () => {
  const profile = engine.defaultProfile(),
    workload = engine.defaultWorkload();
  const before = structuredClone({ profile, workload });
  const sweep = sweepConfiguration(profile, workload);
  assert.equal(sweep.evaluatedCount, 36);
  assert.equal(new Set(sweep.candidates.map((c) => c.id)).size, 36);
  assert.ok(sweep.feasibleCount > 0);
  assert.equal(sweep.shortlist.length, 6);
  assert.deepEqual({ profile, workload }, before);
  for (const c of sweep.candidates) {
    assert.equal(c.profile.autoscale, false);
    assert.ok(!c.profile.cacheAffinity || c.profile.prefixCache);
    assert.equal(c.profile.headroom, profile.headroom);
    assert.deepEqual(
      c.evaluation,
      engine.evaluateProfile(c.profile, workload, 90, 42),
    );
  }
  assert.equal(sweep.candidates[0].evaluation.feasible, true);
  const cheapestPassing = Math.min(
    ...sweep.candidates
      .filter((c) => c.evaluation.feasible)
      .map((c) => c.evaluation.summary.hourlyCost),
  );
  assert.equal(
    sweep.candidates[0].evaluation.summary.hourlyCost,
    cheapestPassing,
  );
  assert.match(sweep.scope, /not a global search/);
});

test('sweep keeps failed candidates visible and never relabels overload as feasible', () => {
  const sweep = sweepConfiguration(engine.defaultProfile(), {
    ...engine.defaultWorkload(),
    rps: 10000,
  });
  assert.equal(sweep.feasibleCount, 0);
  assert.ok(
    sweep.candidates.every((c) => !c.pareto && c.evaluation.reasons.length > 0),
  );
  const summary = summarizeSweepForModel(sweep);
  assert.equal(summary.candidates.length, sweep.evaluatedCount);
  assert.ok(
    summary.candidates.every(
      (c) => c.feasible === false && c.gateFailures.length,
    ),
  );
});

test('sweep rejects invalid or silently clamped traffic and invalid placements', () => {
  for (const patch of [
    { rps: 0 },
    { rps: NaN },
    { rps: 10001 },
    { inputTokens: -1 },
    { sharedPrefix: 2 },
    { mix: { gemma: -1, qwen: 1, kimi: 1 } },
  ])
    assert.throws(() =>
      sweepConfiguration(engine.defaultProfile(), {
        ...engine.defaultWorkload(),
        ...patch,
      }),
    );
  assert.throws(() =>
    sweepConfiguration(
      { ...engine.defaultProfile(), batchConcurrency: 0 },
      engine.defaultWorkload(),
    ),
  );
});

test('model summary strips arbitrary profile and placement metadata', () => {
  const profile = engine.defaultProfile();
  profile.name = 'private-user-label';
  profile.id = 'private-profile-id';
  profile.placements[0].id = 'private-placement-id';
  const summary = summarizeSweepForModel(
    sweepConfiguration(profile, engine.defaultWorkload()),
  );
  assert.equal(JSON.stringify(summary).includes('private-'), false);
  assert.ok(
    summary.candidates.every((candidate) =>
      /^sweep-\d+-\d+-\d+$/.test(candidate.id),
    ),
  );
});
