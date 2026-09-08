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
  execFileSync(process.execPath, ['--test', 'tests/simulation.test.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, SIM_BUILD_DIR: build },
  });
} finally {
  rmSync(build, { recursive: true, force: true });
}
