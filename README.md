# Inference Autopilot — fleet simulation

An interactive deployment console with Gemma 4 26B, Qwen 3.5 397B, and Kimi K3 across H200, GB200, GB300, and TPU v7 hardware groups. No cloud account, GPU, API key, or model download is required. All throughput, latency, prices, and optimization results are synthetic. The optimizer is deterministic code, with no live Astra or model calls.

## Run and validate

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev -- --port 3002 --hostname 127.0.0.1
npm test
npm run typecheck
npm run lint
npm run build
```

The main route is the new fleet console. `/lab` preserves the earlier single-GPU and node experiment lab; see LEGACY_LAB.md for that engine's different assumptions and trace format.

## Suggested demo

1. Observe requests entering the model-aware router and reaching compatible replicas. Model identity stays fixed; hardware color indicates pressure, while packet color identifies the model. Animated dots are samples, not individual counted requests.
2. Surge one model, then all three. Watch queues, yellow/red pressure, and eight-second replica warmups. Autoscaling respects chip, memory, model-slot, and compatibility constraints; exhausted capacity leaves visible pressure.
3. Reset for a repeatable optimization demonstration. Vary input/output length, prefix reuse, burstiness, request rate, model mix, queue budget, and latency targets. The workload controls explain their effects.
4. Run optimization. The simulation pauses so the evidence remains reviewable. Inspect a profile to see placement changes, serving flags, and projected cost, TTFT, and output throughput. Failed candidates cannot be approved.
5. Approve a passing profile. A separate green pool warms, takes a canary, receives increasing traffic, verifies, and drains blue. Both pools consume resources and incur costs during overlap. Watch actual simulated traffic weights and updated metrics.
6. Abort a rollout to restore blue while retaining queues and accounting. Export a report to retain settings, evidence, and activity.

All state and audit history are session-local. Refresh resets the fleet. Changes never operate customer infrastructure.

## Inventory and compatibility

The eight simulated hardware groups are two 4-chip H200 groups, two 8-chip GB200 groups, three 8-chip GB300 groups, and one 4-chip TPU v7 group. These are illustrative scheduling groups, not a claim that NVL72 racks contain only eight GPUs.

- Gemma uses one chip with an assumed 64 GB resident footprint; it can run on all four hardware types in this demo.
- Qwen uses four GPU chips with an assumed 480 GB quantized resident footprint. The demo keeps Qwen GPU-only; this is a scenario restriction, not a claim that TPU support is unavailable.
- Kimi uses eight GB300 chips with an assumed 1,600 GB resident footprint. Its TPU path is not enabled.

Real parameter counts and nominal accelerator memory inform these constraints. Footprints, parallelism, runtime support, and performance still require real deployment validation. GB200 uses 186 GB per GPU, GB300 288 GB, H200 141 GB, and TPU v7 192 GiB (converted to decimal GB internally).

Sources: [Gemma](https://ai.google.dev/gemma/docs/core), [Qwen](https://huggingface.co/Qwen/Qwen3.5-397B-A17B), [Kimi](https://github.com/MoonshotAI/Kimi-K3), [H200](https://www.nvidia.com/en-us/data-center/h200/), [GB200](https://www.nvidia.com/en-us/data-center/gb200-nvl72/), [GB300](https://www.nvidia.com/en-gb/data-center/gb300-nvl72/), [TPU v7](https://docs.cloud.google.com/tpu/docs/tpu7x), [vLLM TPU matrix](https://docs.vllm.ai/projects/tpu/en/latest/recommended_models/).

## Simulation and evidence

The fleet engine advances a seeded, fluid queue model in one-second steps. Fractional request volumes are intentional. Capacity depends on model, hardware, input/output lengths, prefix reuse, batch concurrency, and cache affinity. Model-aware routing distributes demand across ready replicas. Queues and rejections reflect admission limits. Whole activated hardware groups are charged, including during warmup.

TTFT and token interval are estimates, not measured percentiles. Utilization is modeled service pressure, not measured GPU SM utilization. Prefix reuse reduces modeled input work without implementing a real KV cache. Arrival waves are synthetic; seasonality is not learned from history.

Candidate evidence uses a repeatable 90-second replay with placements frozen, so an autoscaling candidate cannot pass merely by allocating extra unpriced replicas. Approval binds to exact profile/workload context, rejects stale or repeated application, and checks feasibility again. Blue-green verification supplements replay evidence with green-pool observations. The UI distinguishes projected steady-state changes from charged overlap costs.

During rollout, autoscaling and workload edits are frozen. Green receives a temporary independent copy of the modeled hardware inventory; no extra real resources are provisioned. Warming, migration, and draining times are accelerated demo assumptions. Rollback preserves pending work and lifetime request/cost counters.

Limitations include no kernels, network/interconnect contention, distributed tensor-parallel communication, KV memory dynamics, real cold-start times, quality evaluation, predictive seasonality, or cloud execution. This is evidence about the toy model, not proof of production savings. Production use needs calibrated measurements and a separately authorized cloud adapter.

## Code

- `lib/fleet-engine.ts`: inventory, traffic, placement validation, autoscaling, and recommendations.
- `lib/fleet-rollout.ts`: evidence-bound approval and rollout phases.
- `lib/fleet-session.ts`: independent blue/green pools, traffic split, accounting, and rollback.
- `components/fleet-map.tsx`: routing animation and hardware/replica topology.
- `app/fleet-console.tsx`: controls, inspection, approvals, charts, and exports.
- `tests/`: reproducibility, placement constraints, overload, conservation, approval, migration, and rollback checks.

Optional WebMCP read tools are feature-detected. Browser contract validation and visual/interaction QA were not performed. Validation covers authored-source lint, TypeScript, simulation/workflow tests, HTTP rendering, and the production build.
