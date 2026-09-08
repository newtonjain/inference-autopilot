import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const {
  DEFAULT_SETTINGS,
  generateTrace,
  baselineConfig,
  simulate,
  candidateConfigs,
  hash,
  validateTrace,
} = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'simulator.js')).href
  )
).default;
const { propose, approveAndApply } = (
  await import(
    pathToFileURL(join(process.env.SIM_BUILD_DIR, 'workflow.js')).href
  )
).default;
const s = { ...DEFAULT_SETTINGS };
const trace = generateTrace(s);
const config = baselineConfig('chip');
test('same seed, trace, and profile reproduce every metric', () => {
  assert.deepEqual(generateTrace(s), trace);
  assert.deepEqual(simulate(trace, config, s), simulate(trace, config, s));
  assert.notEqual(hash(trace), hash(generateTrace({ ...s, seed: 43 })));
});
test('unique prefixes get no cache benefit and no decoding shortcut', () => {
  const t = generateTrace({ ...s, prefix: 0 });
  const on = simulate(t, config, s),
    off = simulate(t, { ...config, cache: false }, s);
  assert.equal(on.cacheHit, 0);
  for (const key of [
    'p95ttft',
    'p95itl',
    'outputTokens',
    'completed',
    'elapsed',
  ])
    assert.equal(on[key], off[key]);
});
test('repeat-prefix caching reduces prefill pressure without changing token demand', () => {
  const on = simulate(trace, config, s),
    off = simulate(trace, { ...config, cache: false }, s);
  assert.ok(on.cacheHit > 0);
  assert.equal(on.outputTokens, off.outputTokens);
  assert.ok(on.p95ttft < off.p95ttft);
});
test('cache fingerprints are isolated by tenant and model', () => {
  const t = {
    version: 1,
    seed: 42,
    duration: 30,
    requests: [
      {
        id: 0,
        arrival: 0,
        model: 'gemma26',
        tenant: 'a',
        prefix: 'same',
        prefixTokens: 1000,
        input: 1200,
        output: 10,
      },
      {
        id: 1,
        arrival: 10,
        model: 'gemma26',
        tenant: 'b',
        prefix: 'same',
        prefixTokens: 1000,
        input: 1200,
        output: 10,
      },
    ],
  };
  assert.equal(simulate(t, config, s).cacheHit, 0);
});
test('memory and busy time stay bounded in every topology', () => {
  for (const scope of ['chip', 'node', 'fleet']) {
    const settings = { ...s, scope, load: 3 };
    const t = generateTrace(settings);
    const r = simulate(t, baselineConfig(scope), settings);
    assert.equal(r.completed + r.failed, r.count);
    assert.ok(r.utilization >= 0 && r.utilization <= 100.00001);
    assert.ok(r.workers.every((w) => w.peakMemoryGB <= 72.000001));
    assert.ok(r.elapsed >= t.duration);
  }
});
test('burst overload is not hidden by omitting unfinished work', () => {
  const stressed = generateTrace({ ...s, load: 3 }, true);
  const r = simulate(stressed, config, s);
  assert.ok(!r.feasible);
  assert.ok(r.compliant / r.count < 0.95);
  assert.equal(r.completed + r.failed, r.count);
});
test('single node bills all four GPUs even when traffic is quiet', () => {
  const settings = { ...s, scope: 'node', load: 0.2 };
  const r = simulate(generateTrace(settings), baselineConfig('node'), settings);
  assert.equal(r.hourlyCost, 4 * s.price);
});
test('fleet consolidation retains both models and rejects overload', () => {
  const settings = { ...s, scope: 'fleet' };
  const t = generateTrace(settings),
    base = baselineConfig('fleet');
  const two = candidateConfigs(base, 'fleet').find(
    (c) => c.config.id === 'consolidate',
  );
  const one = candidateConfigs(base, 'fleet').find(
    (c) => c.config.id === 'aggressive',
  );
  const r = simulate(t, two.config, settings),
    bad = simulate(t, one.config, settings);
  assert.ok(r.feasible);
  assert.equal(r.hourlyCost, 4 * s.price);
  assert.deepEqual(
    [...new Set(r.workers.map((w) => w.model))].sort((a, b) =>
      a.localeCompare(b),
    ),
    ['gemma26', 'gemma31'],
  );
  assert.ok(!bad.feasible);
});
test('unhosted models fail instead of being silently substituted', () => {
  const settings = { ...s, scope: 'fleet' };
  const generated = generateTrace(settings);
  const t = {
    ...generated,
    requests: generated.requests.filter((r) => r.model === 'gemma31'),
  };
  const r = simulate(t, baselineConfig('chip'), s);
  assert.equal(r.failed, t.requests.length);
  assert.equal(r.completed, 0);
});
test('malformed trace imports and impossible configurations are rejected', () => {
  assert.deepEqual(validateTrace(trace), trace);
  assert.throws(() =>
    validateTrace({
      ...trace,
      requests: [{ ...trace.requests[0], input: -1 }],
    }),
  );
  assert.throws(() =>
    validateTrace({
      ...trace,
      requests: [trace.requests[0], trace.requests[0]],
    }),
  );
  assert.throws(() => simulate(trace, { ...config, concurrency: 0 }, s));
});
test('approval binds to workload, settings, and current configuration', () => {
  const option = candidateConfigs(config, 'chip').find(
    (c) => c.config.id === 'prefill',
  );
  const candidate = { ...option, result: simulate(trace, option.config, s) };
  const proposal = propose(candidate, trace, config, s);
  assert.throws(
    () =>
      approveAndApply(
        proposal,
        trace,
        { ...config, concurrency: 9 },
        s,
        new Set(),
      ),
    /changed/,
  );
  assert.throws(
    () =>
      approveAndApply(
        proposal,
        trace,
        config,
        { ...s, ttftSlo: 0.5 },
        new Set(),
      ),
    /changed/,
  );
  assert.throws(
    () =>
      approveAndApply(
        proposal,
        generateTrace({ ...s, seed: 43 }),
        config,
        s,
        new Set(),
      ),
    /changed/,
  );
  const applied = new Set();
  assert.ok(approveAndApply(proposal, trace, config, s, applied).feasible);
  assert.throws(
    () => approveAndApply(proposal, trace, config, s, applied),
    /already/,
  );
});
test('failed experiments cannot become approved proposals', () => {
  const option = candidateConfigs(config, 'chip').find(
    (c) => c.config.id === 'decode',
  );
  const candidate = { ...option, result: simulate(trace, option.config, s) };
  assert.throws(() => propose(candidate, trace, config, s), /did not pass/);
});
test('zero offered requests cannot produce an approvable result', () => {
  const r = simulate(
    { version: 1, seed: 0, duration: 30, requests: [] },
    config,
    s,
  );
  assert.ok(!r.feasible);
  assert.match(r.reasons.join(), /Insufficient evidence/);
  assert.equal(r.costPerMillion, null);
});
test('cache keys remain isolated when imported labels contain delimiters', () => {
  const t = {
    version: 1,
    seed: 42,
    duration: 30,
    requests: [
      {
        id: 0,
        arrival: 0,
        model: 'gemma26',
        tenant: 'a/b',
        prefix: 'c',
        prefixTokens: 1000,
        input: 1200,
        output: 10,
      },
      {
        id: 1,
        arrival: 10,
        model: 'gemma26',
        tenant: 'a',
        prefix: 'b/c',
        prefixTokens: 1000,
        input: 1200,
        output: 10,
      },
    ],
  };
  assert.equal(simulate(t, config, s).cacheHit, 0);
});
test('a shorter cache lookup does not shrink the stored prefix or leak accounting', () => {
  const t = {
    version: 1,
    seed: 42,
    duration: 30,
    requests: [1000, 500, 1000].map((tokens, i) => ({
      id: i,
      arrival: i * 10,
      model: 'gemma26',
      tenant: 'a',
      prefix: 'same',
      prefixTokens: tokens,
      input: tokens + 200,
      output: 10,
    })),
  };
  const r = simulate(t, config, s);
  assert.ok(Math.abs(r.cacheHit - (1500 / 3100) * 100) < 0.00001);
});
