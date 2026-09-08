import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const c = require(path.join(process.env.SIM_BUILD_DIR, 'analysis-contract.js'));
const e = require(path.join(process.env.SIM_BUILD_DIR, 'fleet-engine.js'));
function telemetry() {
  const now = Date.now();
  return {
    schemaVersion: 1,
    kind: 'inference-autopilot.telemetry',
    source: 'gcp-managed-prometheus',
    rateKind: 'completed',
    latencyKind: 'mean',
    observedAt: new Date(now).toISOString(),
    startTime: new Date(now - 300000).toISOString(),
    endTime: new Date(now).toISOString(),
    models: ['gemma', 'qwen', 'kimi'].map((model) => ({
      model,
      rps: 8,
      inputTokens: 1200,
      outputTokens: 300,
      ttftMs: 100,
      tokenMs: 30,
      queue: 0,
      prefixHitRate: 0.6,
    })),
  };
}
test('API profile and workload contracts reject unbounded input before simulation', () => {
  assert.deepEqual(c.parseWorkload(e.defaultWorkload()), e.defaultWorkload());
  assert.deepEqual(c.parseProfile(e.defaultProfile()), e.defaultProfile());
  assert.throws(() =>
    c.parseWorkload({ ...e.defaultWorkload(), rps: Infinity }),
  );
  assert.throws(() =>
    c.parseProfile({
      ...e.defaultProfile(),
      placements: [
        { id: 'x', nodeId: 'metadata.internal', model: 'kimi', replicas: 1 },
      ],
    }),
  );
  assert.throws(() =>
    c.parseProfile({ ...e.defaultProfile(), placements: Array(33).fill({}) }),
  );
});
test('observability import strips arbitrary content and preserves measurement semantics', () => {
  const t = telemetry();
  t.rawPrompts = 'never-forward';
  t.models[0].secret = 'never-forward';
  const parsed = c.parseTelemetry(t);
  assert.ok(!JSON.stringify(parsed).includes('never-forward'));
  assert.equal(parsed.rateKind, 'completed');
  assert.equal(parsed.latencyKind, 'mean');
  assert.equal(c.telemetryWorkload(parsed, e.defaultWorkload()).rps, 24);
});
test('stale, missing and mismatched telemetry cannot silently become demand evidence', () => {
  const t = telemetry();
  assert.throws(() => c.parseTelemetry({ ...t, rateKind: 'incoming' }));
  assert.throws(() =>
    c.parseTelemetry({ ...t, models: [t.models[0], t.models[0], t.models[0]] }),
  );
  t.models[0].rps = null;
  assert.throws(() =>
    c.telemetryWorkload(c.parseTelemetry(t), e.defaultWorkload()),
  );
  const old = telemetry();
  old.endTime = new Date(Date.now() - 7200000).toISOString();
  old.startTime = new Date(Date.now() - 7500000).toISOString();
  assert.throws(
    () => c.telemetryWorkload(c.parseTelemetry(old), e.defaultWorkload()),
    /older/,
  );
});

test('future telemetry and windows ending after observation are rejected', () => {
  const t = telemetry();
  assert.throws(() => c.parseTelemetry({ ...t, observedAt: new Date(Date.now() + 600000).toISOString() }));
  assert.throws(() => c.parseTelemetry({ ...t, endTime: new Date(Date.parse(t.observedAt) + 1).toISOString() }));
});
