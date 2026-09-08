import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const build = process.env.SIM_BUILD_DIR || '/tmp/astra-client-check';
const { askAstra, ASTRA_TIMEOUT_MS } = require(
  path.join(build, 'astra-client.js'),
);
const { defaultWorkload, defaultProfile } = require(
  path.join(build, 'fleet-engine.js'),
);
const { sweepConfiguration } = require(path.join(build, 'config-sweep.js'));
const workload = defaultWorkload();
const sweep = sweepConfiguration(defaultProfile(), workload);
const input = { workload, sweep };
const choice = sweep.candidates.find(
  (candidate) => candidate.evaluation.feasible,
).id;
const decision = () => ({
  summary: 'Synthetic replay favors cache affinity.',
  bottleneck: 'Repeated prefills consume serving capacity.',
  recommendations: [
    {
      candidateId: choice,
      reason: 'The feasible replay preserves latency with fewer active groups.',
      risks: ['Validate against production traces before any cloud rollout.'],
    },
  ],
  dataGaps: ['Synthetic latency is not a hardware benchmark.'],
});
const envelope = (value = decision()) => ({
  id: 'resp_test',
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [] },
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(value) }],
    },
  ],
  usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
});
const respond = (body) => async () =>
  new Response(JSON.stringify(body), { status: 200 });

test('Astra uses Responses structured output, server authorization, no storage and a bounded timeout', async () => {
  const result = await askAstra(
    'test-key-not-real',
    input,
    async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer test-key-not-real');
      assert.equal(options.method, 'POST');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(ASTRA_TIMEOUT_MS, 60_000);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6-astra');
      assert.equal(body.store, false);
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      assert.equal(body.max_output_tokens, 2500);
      assert.equal(body.service_tier, 'fast');
      assert.equal(
        JSON.parse(body.input).sweep.evaluatedCount,
        sweep.evaluatedCount,
      );
      assert.match(body.instructions, /synthetic fluid simulation/);
      return new Response(JSON.stringify(envelope()));
    },
  );
  assert.equal(result.model, 'gpt-6-astra');
  assert.equal(result.recommendations[0].candidateId, choice);
  assert.deepEqual(result.usage, {
    input_tokens: 100,
    output_tokens: 80,
    total_tokens: 180,
  });
});

test('HTTP and network failures never expose an API key or upstream response body', async () => {
  const secret = 'private-test-token';
  for (const fetcher of [
    async () => new Response(secret, { status: 401 }),
    async () => {
      throw new Error(secret);
    },
  ]) {
    await assert.rejects(
      askAstra(secret, input, fetcher),
      (error) =>
        !error.message.includes(secret) &&
        ['upstream', 'network'].includes(error.code),
    );
  }
});

test('abort errors are sanitized as a timeout', async () => {
  await assert.rejects(
    askAstra('test', input, async () => {
      throw new DOMException('private details', 'AbortError');
    }),
    (error) =>
      error.code === 'timeout' && !error.message.includes('private details'),
  );
});

test('incomplete, refused, missing, and malformed outputs fail closed', async () => {
  const refused = envelope();
  refused.output[1].content = [{ type: 'refusal', refusal: 'No.' }];
  const malformed = envelope();
  malformed.output[1].content[0].text = '{invalid';
  const extra = envelope();
  extra.output.push(extra.output[1]);
  for (const body of [
    { ...envelope(), status: 'incomplete' },
    { ...envelope(), incomplete_details: { reason: 'max_output_tokens' } },
    refused,
    malformed,
    extra,
    { ...envelope(), output: [] },
  ]) {
    await assert.rejects(
      askAstra('test', input, respond(body)),
      (error) => error.code === 'invalid_response',
    );
  }
});

test('unknown, infeasible, duplicate, and oversized recommendations are rejected', async () => {
  const invalidInput = {
    workload,
    sweep: {
      ...sweep,
      candidates: sweep.candidates.map((candidate) => ({
        ...candidate,
        evaluation: { ...candidate.evaluation, feasible: false },
      })),
    },
  };
  await assert.rejects(
    askAstra('test', invalidInput, respond(envelope())),
    (error) => error.code === 'invalid_response',
  );
  const unknown = decision();
  unknown.recommendations[0].candidateId = 'invented-profile';
  const duplicate = decision();
  duplicate.recommendations.push(duplicate.recommendations[0]);
  const oversized = decision();
  oversized.summary = 'x'.repeat(1601);
  const arbitraryConfig = decision();
  arbitraryConfig.recommendations[0].profile = { replicas: 999 };
  for (const value of [unknown, duplicate, oversized, arbitraryConfig])
    await assert.rejects(
      askAstra('test', input, respond(envelope(value))),
      (error) => error.code === 'invalid_response',
    );
});

test('no feasible candidate can produce an honest empty recommendation set', async () => {
  const value = decision();
  value.recommendations = [];
  const result = await askAstra(
    'test',
    { workload, sweep: { ...sweep, candidates: [] } },
    respond(envelope(value)),
  );
  assert.deepEqual(result.recommendations, []);
});

test('telemetry sends only recognized numeric aggregates and preserves evidence limitations', async () => {
  const telemetry = {
    kind: 'inference-autopilot.telemetry',
    rawTrace: 'do-not-send',
    models: [
      {
        model: 'gemma',
        rps: 24,
        ttftMs: 400,
        labels: 'private-label',
        inputTokens: null,
      },
    ],
    clusterName: 'private-cluster',
  };
  const result = await askAstra(
    'test',
    {
      ...input,
      telemetry,
      workload: { ...workload, hiddenPrompt: 'do-not-send' },
    },
    async (_url, options) => {
      assert.ok(!options.body.includes('do-not-send'));
      assert.ok(!options.body.includes('private-label'));
      assert.ok(!options.body.includes('private-cluster'));
      const facts = JSON.parse(JSON.parse(options.body).input);
      assert.equal(facts.telemetry.models[0].rps, 24);
      assert.match(facts.telemetry.rateKind, /not ingress/);
      return new Response(JSON.stringify(envelope()));
    },
  );
  assert.ok(
    result.dataGaps.some(
      (gap) =>
        gap.includes('not ingress demand') && gap.includes('uncalibrated'),
    ),
  );
});

test('historical sample sends 48 hourly summaries and only distinct representative profiles', async () => {
  const {sampleTraffic}=require(path.join(build,'sample-traffic.js'));
  const sample=sampleTraffic('overnight');
  let sent;
  await askAstra('test-key-not-real',{...input,history:sample.history}, async (_url, options)=>{
    sent=JSON.parse(JSON.parse(options.body).input);
    return respond(envelope())();
  });
  assert.equal(sent.trafficHistory.source,'synthetic');
  assert.equal(sent.trafficHistory.hourly.length,48);
  assert.equal(sent.trafficHistory.selectedPhase,'overnight');
  assert.equal(sent.sweep.candidates.length,3);
  const hidden=sweep.candidates.find(c=>c.evaluation.feasible && !sweep.shortlist.some(s=>s.id===c.id));
  if(hidden){const d=decision();d.recommendations[0].candidateId=hidden.id;await assert.rejects(()=>askAstra('test-key-not-real',input,respond(envelope(d))));}
});
