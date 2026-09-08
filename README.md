# Inference Autopilot

**An AI agent for continuously optimizing production inference fleets.**

Inference Autopilot is being built to run alongside your inference infrastructure and turn deployment configuration, traffic patterns, and operational telemetry into actionable optimization plans. Its goal is to help teams **reduce latency, increase throughput, and lower cost** while protecting model quality and service-level objectives.

The product vision spans heterogeneous fleets: multiple models and use cases, different accelerator architectures, and deployments across hyperscalers, neoclouds, and on-premises environments. OpenAI Astra serves as the analyst, reasoning about workload behavior and explaining the tradeoffs behind each recommendation.

## Why Inference Autopilot

Inference workloads change throughout the day. A deployment that works well for short interactive requests can struggle with long-context prompts, sustained code generation, or bursts of concurrent agent traffic. Capacity can sit idle in one part of the fleet while another model queues requests or misses its latency target.

Inference Autopilot is designed to connect these signals and answer practical questions:

- Where should each model run, and how many complete serving replicas does it need?
- Would a different accelerator, placement, batching policy, or cache strategy improve service?
- Should the fleet consolidate during quiet periods or warm capacity before an expected surge?
- When would a different parallelism strategy or prefill/decode layout justify its communication and memory overhead?
- Which changes deliver worthwhile savings without compromising latency, reliability, or quality?

Optimization is a constrained tradeoff. The objective is useful work per dollar within the application's requirements, with enough headroom to handle variability—not maximum utilization at any cost.

## How the agent will work

The production design is a continuous loop: **observe → evaluate → recommend → approve → deploy → verify**.

1. **Observe the fleet.** Discover models, serving engines, deployment settings, replica placement, accelerator resources, and distributed topology. Collect scoped metrics and traces from the customer's observability systems.
2. **Understand demand.** Analyze request arrival rates, input and output lengths, concurrency, prefix reuse, queueing, and workload mix. Build a history of daily variation, peaks, and regressions; use longer histories to investigate seasonality.
3. **Evaluate alternatives.** Generate candidate deployment profiles and compare them through replay, benchmarks, and compatibility checks. Include available capacity, quotas, topology, memory, pricing, and rollout overhead in the assessment.
4. **Recommend with Astra.** Explain the bottleneck, the proposed changes, the expected benefit, the supporting evidence, and the uncertainties. Rank alternatives against the operator's cost, latency, throughput, and quality priorities.
5. **Deploy within policy.** Present a reviewable plan for approval. An authorized controller will provision and warm the green deployment, shift traffic gradually, verify health, and drain the old deployment—or roll back when gates fail.
6. **Keep monitoring.** Compare actual outcomes against the baseline and predicted benefit. Detect regressions, retain an audit trail, and feed the results into subsequent recommendations.

The intended customer-side footprint is a Kubernetes collector and controller installed alongside existing serving infrastructure, with an analyst service connected through authenticated APIs. Observation and deployment permissions will be separated. Teams will start with recommendations and explicit approval, with policy-bounded automation available as confidence grows.

## The dashboard

The dashboard brings fleet visibility, optimization decisions, and rollout outcomes into one operating surface.

### Live fleet

Follow requests from the router to the model replicas serving them. See placement across hardware types, ready and warming replicas, accelerator ranks, demand over time, queues, and capacity pressure. Distributed serving groups should be visible as complete replicas rather than disconnected worker pods.

### Optimization

Use **Analyze with Astra** to turn recent workload history into distinct deployment options. Inspect the exact configuration and placement changes, their rationale, and their expected impact on three pillars:

| Pillar | What operators should be able to compare |
| --- | --- |
| Latency | Time to first token, inter-token latency, tail latency, and queue delay against application SLOs |
| Throughput | Completed requests, generated tokens, concurrency, and useful work per accelerator |
| Cost | Fleet spend, cost per request or token, idle capacity, and temporary rollout costs |

A recommendation should make its tradeoffs clear. More capacity may protect latency at a higher cost; consolidation may save money while reducing burst headroom. Equal throughput can be the correct result when both profiles already serve all offered demand.

### Deployment and benefits

Approve a profile and follow its blue-green rollout: allocation, warmup, canary traffic, migration, verification, and drain. The production dashboard will track projected versus realized benefits after deployment, including recurring savings, SLO performance, and regressions.

Benefit measurement will account for changes in demand and workload mix so that a quieter traffic period is not mistaken for an optimization win. Rollout overhead and rollback events will remain part of the record.

### Simulation and experimentation

Use the same fleet view to test changes in traffic intensity, request shape, prefix reuse, concurrency, and burstiness. Explore alternatives before committing production resources, and compare experiments against a defined baseline.

## Optimization across the stack

Inference Autopilot's roadmap extends from fleet orchestration to the execution path inside each accelerator.

| Layer | Planned optimization areas |
| --- | --- |
| Fleet and orchestration | Placement, complete-replica scaling, consolidation, predictive capacity, routing, and allocation across clusters and providers |
| Distributed serving | Tensor, pipeline, expert, and data parallelism; topology-aware placement; prefill/decode disaggregation and KV-transfer tradeoffs |
| Serving engine | Continuous batching, admission control, prefix caching, cache affinity, KV-cache policies, precision, and compatible runtime configurations |
| Kernels and compilation | Recommend attention and matrix-multiplication kernels, fusion, quantization paths, compiler settings, and hardware-specific execution choices based on profiling and benchmarks |

Kernel-level work will begin with diagnosis and recommendations. Applying lower-level changes will require verified hardware/runtime compatibility, numerical and model-quality checks, and reproducible performance evidence.

## Next steps

1. **Make installation straightforward across environments.** Package collectors, workload discovery, and narrowly scoped permissions for GKE, EKS, and AKS. Extend deployment adapters to neocloud Kubernetes clusters and on-premises fleets, including disconnected or restricted-network operating requirements.
2. **Connect production telemetry and cost data.** Integrate cloud monitoring, Prometheus, and OpenTelemetry through a common data contract. Add durable workload history, verified topology, accelerator telemetry, billing data, quotas, and reservation awareness.
3. **Calibrate recommendations against real serving systems.** Benchmark model/engine/hardware combinations, replay representative workloads, estimate uncertainty, and validate predicted gains against measured results.
4. **Deliver the production rollout controller and benefits tracking.** Add approval policies, complete serving-group readiness, router integration, canary gates, automatic rollback, audit retention, and demand-adjusted measurement of realized improvements.
5. **Expand engine, compiler, and kernel optimization.** Progress from configuration advice to profiler-backed recommendations and validated experiments deeper in the inference stack.
6. **Support more modalities and use cases.** Extend beyond text and image workloads to speech, audio generation, video, embeddings, and mixed-modality pipelines. Use modality-specific objectives such as time to first audio, real-time factor, frames per second, end-to-end pipeline latency, and output quality.
7. **Grow toward policy-bounded autonomy.** Learn from deployment outcomes, anticipate recurring demand, and apply eligible changes within operator-defined budgets, SLOs, and rollback policies.

## Try the current prototype

This repository contains the working demonstration of that vision: a heterogeneous fleet simulator, a real server-side Astra API integration, a two-day synthetic traffic history, profile inspection, and simulated blue-green rollout. It also includes GCP observer and telemetry-collection scaffolding.

**The production capabilities described above are the roadmap.** The prototype does not autonomously operate a customer cloud fleet. Its performance and cost comparisons are simulated, not measured production savings; additional provider adapters, calibrated performance models, and the production rollout controller remain to be built.

With Node.js 22.13 or newer:

```sh
npm ci
npm run dev -- --port 3002 --host localhost
```

Configure `OPENAI_API_KEY` in the ignored `.dev.vars` file before starting the local server. Keep it server-side and never commit it. Open the local URL and sign in when prompted to enable Astra analysis and saved records.

The demo journey is **Live fleet → Optimization → Analyze with Astra → Inspect → approve blue-green rollout → Simulation**. The two-day sample history is supplied automatically; no cloud connection is required for this demonstration.

For implementation details and validation:

- [Astra integration](docs/ASTRA.md)
- [Sample traffic and historical analysis](docs/SAMPLE-TRAFFIC.md)
- [GCP attachment](docs/GCP.md) and [telemetry collection](docs/TELEMETRY.md)
- [Demo scenarios and evidence](docs/DEMO.md)

```sh
npm test
npm run typecheck
npm run lint
npm run build
```
