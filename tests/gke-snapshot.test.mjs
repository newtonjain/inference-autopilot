import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { parseGkeSnapshot, observedReplicas } = require(
  path.join(process.env.SIM_BUILD_DIR, 'gke-snapshot.js'),
);
const example = () =>
  JSON.parse(readFileSync('deploy/gcp/examples/snapshot.json', 'utf8'));
test('distributed workers count as one serving copy, not two replicas or TP×PP×EP chips', () => {
  const s = parseGkeSnapshot(JSON.stringify(example()));
  const view = observedReplicas(s);
  assert.equal(view.replicas.length, 1);
  assert.equal(view.replicas[0].pods, 2);
  assert.equal(view.replicas[0].hosts.length, 2);
  assert.equal(view.replicas[0].chips, 8);
  assert.equal(view.replicas[0].readyCandidate, true);
});
test('missing or inconsistent ranks cannot appear ready', () => {
  const s = example();
  s.pods.pop();
  assert.equal(
    observedReplicas(parseGkeSnapshot(JSON.stringify(s))).replicas[0]
      .readyCandidate,
    false,
  );
  const conflict = example();
  conflict.pods[1].labels['autopilot/hardware'] = 'h200';
  const view = observedReplicas(parseGkeSnapshot(JSON.stringify(conflict)));
  assert.equal(view.replicas.length, 1);
  assert.equal(view.replicas[0].readyCandidate, false);
});
test('unhealthy snapshots and failed pods stay unverified', () => {
  const s = example();
  s.ready = false;
  assert.equal(
    observedReplicas(parseGkeSnapshot(JSON.stringify(s))).replicas[0]
      .readyCandidate,
    false,
  );
  s.ready = true;
  s.pods[0].ready = false;
  assert.equal(
    observedReplicas(parseGkeSnapshot(JSON.stringify(s))).replicas[0]
      .readyCandidate,
    false,
  );
});
test('snapshot import rejects malformed identity, bounds and accelerator fields', () => {
  const duplicate = example();
  duplicate.pods.push(duplicate.pods[0]);
  assert.throws(() => parseGkeSnapshot(JSON.stringify(duplicate)), /Duplicate/);
  const bad = example();
  bad.pods[0].accelerators[0]['nvidia.com/gpu'] = -8;
  assert.throws(() => parseGkeSnapshot(JSON.stringify(bad)), /accelerator/);
  assert.throws(() => parseGkeSnapshot('{}'), /version 1/);
  assert.throws(() => parseGkeSnapshot(' '.repeat(2_000_001)), /limit/);
});
test('only allowlisted fields survive import and unlabeled pods are not replicas', () => {
  const s = example();
  s.pods[0].labels['customer/private'] = 'not-exported';
  s.pods[0].env = 'not-exported';
  delete s.pods[0].labels['autopilot/replica'];
  const parsed = parseGkeSnapshot(JSON.stringify(s));
  assert.equal(JSON.stringify(parsed).includes('not-exported'), false);
  const view = observedReplicas(parsed);
  assert.equal(view.unlabeledPods, 1);
  assert.equal(view.replicas[0].readyCandidate, false);
});
test('prefill and decode are separate weight copies even with a reused logical identifier', () => {
  const s = example();
  for (const p of s.pods) {
    p.labels['autopilot/pp'] = '1';
    p.labels['autopilot/role'] = p.name.endsWith('0') ? 'prefill' : 'decode';
  }
  const v = observedReplicas(parseGkeSnapshot(JSON.stringify(s)));
  assert.equal(v.replicas.length, 2);
  assert.ok(v.replicas.every((r) => r.readyCandidate));
  assert.equal(
    v.replicas.reduce((n, r) => n + r.chips, 0),
    8,
  );
});

test('expert groups cannot exceed available TP ranks under DP1', () => {
  const s = example();
  s.pods.forEach((p) => (p.labels['autopilot/ep'] = '1024'));
  const view = observedReplicas(parseGkeSnapshot(JSON.stringify(s)));
  assert.equal(view.replicas[0].readyCandidate, false);
  assert.ok(view.replicas[0].issues.some((x) => x.includes('Expert group')));
});
