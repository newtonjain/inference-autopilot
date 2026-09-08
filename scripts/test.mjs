import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const build = mkdtempSync(join(tmpdir(), 'autopilot-test-'));
try {
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      'lib/simulator.ts',
      'lib/workflow.ts',
      'lib/fleet-engine.ts',
      'lib/fleet-rollout.ts',
      'lib/fleet-session.ts',
      'lib/fleet-topology.ts',
      'lib/fleet-scenarios.ts',
      'lib/gke-snapshot.ts',
      'lib/config-sweep.ts',
      'lib/astra-client.ts',
      'lib/analysis-contract.ts',
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
  execFileSync(
    process.execPath,
    [
      '--test',
      'tests/simulation.test.mjs',
      'tests/fleet-engine.test.mjs',
      'tests/fleet-rollout.test.mjs',
      'tests/fleet-session.test.mjs',
      'tests/fleet-topology.test.mjs',
      'tests/fleet-scenarios.test.mjs',
      'tests/gke-snapshot.test.mjs',
      'tests/config-sweep.test.mjs',
      'tests/astra-client.test.mjs',
      'tests/analysis-contract.test.mjs',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, SIM_BUILD_DIR: build },
    },
  );
} finally {
  rmSync(build, { recursive: true, force: true });
}
