import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const build = mkdtempSync(join(tmpdir(), 'autopilot-demo-'));
try {
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      'lib/fleet-scenarios.ts',
      'lib/fleet-engine.ts',
      '--module',
      'commonjs',
      '--target',
      'es2022',
      '--skipLibCheck',
      '--outDir',
      build,
    ],
    { stdio: 'inherit' },
  );
  const require = createRequire(import.meta.url);
  const { demoScenarios } = require(join(build, 'fleet-scenarios.js'));
  const {
    evaluateProfile,
    recommendProfiles,
    createFleetState,
    tickFleet,
    summarize,
  } = require(join(build, 'fleet-engine.js'));
  const report = {
    evidence:
      'Synthetic fluid simulation, not hardware benchmarks or cloud quotes',
    seed: 42,
    seconds: 90,
    scenarios: demoScenarios().map((s) => ({
      id: s.id,
      title: s.title,
      workload: s.workload,
      baseline: evaluateProfile(s.profile, s.workload),
      candidates: recommendProfiles(s.profile, s.workload).map((c) => ({
        name: c.profile.name,
        profile: c.profile,
        evaluation: evaluateProfile(
          { ...c.profile, autoscale: false },
          s.workload,
        ),
      })),
      reactiveAutoscaling: summarize(
        tickFleet(
          createFleetState({ ...s.profile, autoscale: true }, s.workload, 42),
          90,
        ),
      ),
    })),
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  rmSync(build, { recursive: true, force: true });
}
