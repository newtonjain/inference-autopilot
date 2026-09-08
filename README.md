# Inference Autopilot — simulation MVP

A working experiment and approval console for inference deployments. No cloud account, GPU, model download, or API key is required. All inference performance and prices are synthetic assumptions. The optimizer is deterministic code; this release does not call Astra or serve Gemma.

## Run

Use Node.js 22.13 or newer and npm:

```sh
npm ci
npm run dev -- --port 3002 --hostname 127.0.0.1
```

Open the printed local address. `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` validate the app. Lint covers authored app/engine/test code; generated UI primitives are preserved unchanged.

## Demo

1. Start with **Single GPU**: Gemma 4 26B A4B on a simulated H100 80 GB.
2. Run optimization. Inspect passing and rejected profiles, review the exact diff, approve a change, and observe verification.
3. Switch to **Full node**: four independent replicas of the same model. This does not model tensor parallelism or a distributed model.
4. Switch to **Multi-model fleet**: three nodes with two GPUs each. Every node hosts one Gemma 4 26B A4B replica and one Gemma 4 31B replica. Requests retain their original model identity.
5. Under the default seed and assumptions, two-node consolidation passes the targets; the one-node candidate fails. The modeled hourly rate falls from $18 to $12 if the two-node profile is approved. This is an illustrative result, not a cloud quote or realized saving.
6. Inject a 3.5× arrival burst. When an applied profile fails, the previous warm configuration is restored and independently checked. If it also fails, the UI says further action is required.
7. Export the report or save/import a JSON traffic trace. Example files are in `examples/`.

Settings and active profiles are session state; the last 30 audit events persist only in this browser. Refresh resets the experiment workspace. Imported files stay in the browser and are not uploaded to a server.

## Model facts vs assumptions

Google identifies Gemma 4 26B A4B as a MoE with 25.2B total and 3.8B active parameters. The second fleet model is Gemma 4 31B Dense. Source: https://ai.google.dev/gemma/docs/core/model_card_4 . Google describes its BF16 weights fitting on a single H100 80 GB: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ . This does not guarantee every context/concurrency configuration fits.

Everything below is an explicit simulation assumption, adjustable where exposed in the Assumptions dialog:

- 6,500 peak prefill tokens/s and 850 aggregate decode tokens/s for the 26B profile.
- A per-sequence decode ceiling of 55 tokens/s; the 31B profile uses a synthetic 0.72 speed multiplier.
- 56 GB model/runtime residency for 26B; 64 GB for 31B; 90% of 80 GB available to the engine.
- 0.125 MiB KV allocation per token. This is a conservative toy constant, not Gemma's hybrid-attention memory formula.
- Prefix LRU storage is limited to 30% of the remaining KV memory and competes with active requests.
- $3 per GPU-hour. Whole active nodes are charged; idle GPU replicas do not remove VM cost.

## Simulation method

Seeded request arrivals feed model-compatible per-GPU queues. Every candidate receives the exact same trace. In 50 ms steps, each worker admits requests within concurrency and memory limits, splits available time between prefill and decode, and completes output tokens. Cached prefixes remove only prefill work, and cache keys are isolated by model and tenant. Prefix IDs assert exact token-prefix identity; content matching is not inferred.

All workers start warm with empty caches. Workload generation stops at the configured duration, then queues drain for up to 60 more seconds. Unfinished and unhosted requests count as failures. Latency percentiles describe completed requests; completion and service compliance always include all offered requests.

A feasible result requires p95 TTFT and p95 per-request mean token interval under the operator's targets, at most 1% failures, and at least 95% of offered requests meeting both latency targets. Cost includes drain time. Cost per million output tokens uses only successful requests meeting both latency targets.

Limitations: no real kernels, dynamic GPU batching efficiency, SM utilization, interconnect, startup, network transfer, cold deployment, shared KV service, quality evaluation, or live canary. The batch-token cap limits work per scheduler step and may not bind at default rates; candidates do not attribute gains to a non-binding batch cap. The seasonal pattern is generated, not learned from customer history. Large-fleet extrapolation is uncalibrated.

## Approval behavior

Proposals bind to a hash of the current profile, settings, and trace. Failed experiments cannot be proposed. Approval repeats the evaluation, rejects stale context and duplicate application, then updates simulator state. Restoration is instantaneous and explicitly warm; it is not proof of production rollback or restart latency.

## Files

- `lib/simulator.ts`: traffic generation, validation, model queues, memory/caching, results, candidate catalog.
- `lib/workflow.ts`: proposal identity and guarded approval/verification.
- `app/page.tsx`: controls, topology, charts, comparison table, approval, trace import/export, activity log.
- `tests/simulation.test.mjs`: reproducibility, cache correctness, overload, billing, model identity, import validation, and approvals.
- `examples/`: seeded traces and computed reference reports.

## Agent interface

Feature-detected WebMCP tools expose reading active evidence and running experiments. Neither applies a deployment. They use the same visible actions. Browser WebMCP contract validation was not available/performed in this session; these optional tools are not claimed as verified. Browser visual/interaction QA was not requested; TypeScript, authored-source lint, engine/workflow tests, HTTP render, and production build are the validation scope.

## Next integration

Add real endpoint measurements behind the same trace/profile contract, calibrate hardware rates, and introduce Astra tool orchestration with explicit API access. Cloud execution requires a separate allowlisted adapter and a real rollout state machine. Do not describe the current rule-based simulation as live AI infrastructure automation.
