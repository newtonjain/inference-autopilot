# Demo the optimization controller

The core product is a deployment decision loop: observe workload → replay alternatives → reject unsafe plans → approve → warm complete serving groups → migrate traffic → verify → drain or roll back. The dashboard is the evidence and control surface. The code currently uses deterministic recommendations; it does **not** invoke Astra in production.

## Strongest scenarios

The dashboard provides atomic Load scenario buttons. Each resets the initial placements, uses seed 42, disables reactive autoscaling, and pauses so the evidence is repeatable. Choose Run optimization after loading. Metrics below are from the 90-second fluid replay, not measurements on GPUs. TTFT is an estimate, not p95.

| Scenario               | What to show                                                                                                                                       | Reproducible reference result                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared-prefix rescue   | 24 req/s, 3,500 input tokens, 90% shared prefix. Inspect cache-aware serving; show caching, affinity and batch changes, not merely a cache toggle. | Estimated TTFT about 13,214 → 78 ms; output 2,176 → 5,135 tokens/s; modeled compute remains $104/hour.                                                      |
| Off-peak consolidation | 12 req/s. Inspect consolidation, approve, and show green taking traffic before blue retires.                                                       | $104 → $88/hour, 15.4% lower steady-state cost with unchanged offered/completed throughput. Both pools cost money during overlap.                           |
| Qwen launch spike      | 27 req/s with Qwen receiving 50%. Show why cheaper candidates fail and the prewarmed elastic candidate passes.                                     | Cache/consolidation rejected; six-replica elastic profile passes near 78 ms and $168/hour. A successful optimization can increase cost to preserve service. |

Run `npm run demo:report --silent` to reproduce the full evidence without the dashboard. Save stdout as JSON for your presentation evidence. This is a reusable decision-engine entry point, not a manually curated savings chart.

For the Qwen scenario, compare reactive scaling: enable autoscaling and Run after reloading the preset. At 90 simulated seconds the initial unoptimized profile has eight replicas and a modeled $208/hour rate, but only about 70% cumulative offered-request SLO compliance because capacity arrived late. The fixed prewarmed/cached six-replica alternative passes the replay. This compares two whole policies; do not attribute all gains to scaling alone.

The replica matrix updates actual simulator state by model and hardware, including ready and warming counts. The rank inspector makes one Kimi serving copy visible as eight cooperating ranks across two modeled four-chip hosts. Scaling another Kimi replica reserves another complete group. EP shares ranks rather than multiplying GPU count. Inspect the separate TP8 and PD design studies; these do not modify the engine's capacity or claim network speedups.

## Three-minute flow

- **0:00–0:20:** State the problem: inference workloads change faster than static serving configurations. Load off-peak consolidation.
- **0:20–1:00:** Run optimization, Inspect the cheaper passing profile, show placement/config differences, then approve.
- **1:00–1:35:** Watch warmup, canary, traffic migration, two-pool cost, gates and drain. Point to complete replica counts and Kimi ranks, not dashboard decoration.
- **1:35–2:15:** Load Qwen launch spike; show cheap candidates failing and the elastic candidate passing. Explain why utilization alone is the wrong objective.
- **2:15–2:45:** Load the synthetic GKE snapshot. Two worker pods become one TP4×PP2 serving copy. Open the runnable observer chart and explain the read-only permission boundary.
- **2:45–3:00:** State evidence and limits: repeatable simulation today; real cluster observation scaffold included; measured telemetry and an authorized actuator come next.

For a one-minute submission, use one scenario: problem → passing/rejected evidence → approve → traffic migration → measured-systems next step. Clearly identify only the contribution created during the event.

## Judging fit and current gap

The supplied participant guide gives equal weight to Astra in development, Astra in the project, live demo, and technicality. It explicitly excludes projects whose main feature is a dashboard. Lead with the optimization workflow and runnable observer, and show the software operating rather than static charts. Maintain the public repository and a record of original work.

The current runtime is rule-based and does not yet satisfy a strong Astra-in-project story. A future Astra integration should interpret real traces, call the existing bounded replay tools, and explain a proposed deployment while deterministic feasibility and approval gates retain control. Do not claim this integration exists. No API key or live model calls are included here.
