import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const build = process.env.SIM_BUILD_DIR || '/tmp/fleet-topology-check';
const e = require(path.join(build, 'fleet-engine.js'));
const t = require(path.join(build, 'fleet-topology.js'));

test('topology conserves chips and never duplicates a rank within a pool', () => {
  const state = e.tickFleet(
    e.createFleetState(e.defaultProfile(), {
      ...e.defaultWorkload(),
      rps: 500,
    }),
    60,
  );
  const before = JSON.stringify(state);
  const view = t.deriveFleetTopology(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(
    view.totals.chips,
    state.replicas.reduce((sum, r) => sum + e.MODELS[r.model].requiredChips, 0),
  );
  const chips = view.replicas.flatMap((r) =>
    r.ranks.map((rank) => `${r.pool}/${rank.nodeId}/${rank.chipIndex}`),
  );
  assert.equal(new Set(chips).size, chips.length);
  for (const r of view.replicas) {
    assert.equal(r.ranks.length, r.tp * r.pp);
    assert.equal(r.interNodeHops, r.pp - 1);
    assert.equal(
      new Set(r.ranks.map((rank) => rank.physicalNodeId)).size,
      r.pp,
    );
  }
});

test('ready, warming, draining and hardware totals come from both actual pools', () => {
  const blue = e.createFleetState();
  const green = e.createFleetState();
  blue.replicas[0].status = 'draining';
  green.replicas.forEach((r) => {
    r.status = 'warming';
  });
  const view = t.deriveFleetTopology(blue, green);
  assert.deepEqual(view.totals, {
    ready: 2,
    warming: 3,
    draining: 1,
    replicas: 6,
    chips: 26,
  });
  assert.equal(view.counts.length, 12);
  assert.equal(
    view.counts.reduce((s, c) => s + c.blue, 0),
    3,
  );
  assert.equal(
    view.counts.reduce((s, c) => s + c.green, 0),
    3,
  );
  const qwen = view.counts.find(
    (c) => c.model === 'qwen' && c.hardware === 'gb200',
  );
  assert.equal(qwen.total, 2);
  assert.equal(qwen.chips, 8);
  assert.equal(new Set(view.replicas.map((r) => r.id)).size, 6);
});

test('expert ranks overlap tensor ranks instead of multiplying allocated chips', () => {
  const kimi = t
    .deriveFleetTopology(e.createFleetState())
    .replicas.find((r) => r.model === 'kimi');
  assert.equal(kimi.ep, 4);
  assert.equal(kimi.tp, 4);
  assert.equal(kimi.pp, 2);
  assert.equal(kimi.interNodeHops, 1);
  assert.equal(kimi.ranks.length, 8);
  assert.deepEqual(
    kimi.ranks.map((r) => r.expertRank),
    kimi.ranks.map((r) => r.tpRank),
  );
  assert.equal(kimi.dpGroupSize, 1);
});

test('separate distributed blueprints conserve stage ranks and distinguish PD from PP', () => {
  for (const b of t.DISTRIBUTED_BLUEPRINTS) {
    assert.equal(b.status, 'proposed');
    assert.equal(
      b.stages.reduce((s, stage) => s + stage.chips, 0),
      b.totalChips,
    );
    const ranks = b.stages.flatMap((stage) =>
      Array.from({ length: stage.chips }, (_, i) => stage.rankStart + i),
    );
    assert.equal(new Set(ranks).size, b.totalChips);
    assert.ok(
      b.stages.every(
        (stage) => stage.rankEnd - stage.rankStart + 1 === stage.chips,
      ),
    );
    assert.ok(
      b.links.every(
        (link) =>
          b.stages.some((s) => s.id === link.from) &&
          b.stages.some((s) => s.id === link.to),
      ),
    );
  }
  const pd = t.DISTRIBUTED_BLUEPRINTS.find((b) => b.id === 'qwen-pd');
  assert.equal(pd.pp, 1);
  assert.equal(pd.totalChips, pd.chipsPerReplica * 2);
  assert.equal(pd.links[0].kind, 'kv');
});

test('invalid overallocated topology fails rather than fabricating accelerator slots', () => {
  const state = e.createFleetState();
  state.replicas.push({ ...state.replicas[2], id: 'overflow' });
  assert.throws(() => t.deriveFleetTopology(state), /exceeds chip capacity/);
});

test('consolidated placements pack Qwen onto one host without overlap', () => {
  const profile = e
    .recommendProfiles(e.defaultProfile(), e.defaultWorkload())
    .find((c) => c.goal === 'cost').profile;
  const view = t.deriveFleetTopology(e.createFleetState(profile));
  const qwen = view.replicas.find((r) => r.model === 'qwen');
  assert.equal(new Set(qwen.ranks.map((r) => r.physicalNodeId)).size, 1);
  const keys = view.replicas.flatMap((r) =>
    r.ranks.map((rank) => `${r.pool}/${rank.nodeId}/${rank.chipIndex}`),
  );
  assert.equal(new Set(keys).size, keys.length);
});
