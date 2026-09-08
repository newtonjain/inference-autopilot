import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { demoScenarios } = require(
  path.join(process.env.SIM_BUILD_DIR, 'fleet-scenarios.js'),
);
const { recommendProfiles, evaluateProfile } = require(
  path.join(process.env.SIM_BUILD_DIR, 'fleet-engine.js'),
);
test('demo presets preserve their advertised feasibility and cost decisions', () => {
  for (const s of demoScenarios()) {
    assert.equal(s.profile.autoscale, false);
    const candidates = recommendProfiles(s.profile, s.workload).map((c) => ({
      ...c,
      evaluation: evaluateProfile(
        { ...c.profile, autoscale: false },
        s.workload,
      ),
    }));
    const selected = candidates.find((c) => c.profile.name === s.candidate);
    assert.ok(selected.evaluation.feasible, s.id);
    const baseline = evaluateProfile(s.profile, s.workload);
    if (s.id === 'offpeak')
      assert.ok(
        selected.evaluation.summary.hourlyCost < baseline.summary.hourlyCost,
      );
    if (s.id === 'prefix')
      assert.ok(selected.evaluation.summary.ttftMs < baseline.summary.ttftMs);
    if (s.id === 'qwen')
      assert.ok(
        candidates
          .filter((c) => c.profile.name !== s.candidate)
          .every((c) => !c.evaluation.feasible),
      );
  }
});
