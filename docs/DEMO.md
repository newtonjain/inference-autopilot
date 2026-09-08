# Demo the optimization controller

The core product is a deployment decision loop: observe workload → replay alternatives → reject unsafe plans → approve → warm complete serving groups → migrate traffic → verify → drain or roll back. The dashboard is the evidence and control surface. The optional Astra analyst now uses the OpenAI Responses API server-side to rank a bounded configuration sweep, explain tradeoffs, and retain evidence. Deterministic checks remain the feasibility gate.

## Strongest scenarios

On the Simulation screen, expand “Load a repeatable demo scenario” to find atomic Load scenario buttons. Each resets the initial placements, uses seed 42, disables reactive autoscaling, and pauses so the evidence is repeatable. Choose Run optimization after loading. Metrics below are from the 90-second fluid replay, not measurements on GPUs. TTFT is an estimate, not p95.

| Scenario               | What to show                                                                                                                                       | Reproducible reference result                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared-prefix rescue   | 24 req/s, 3,500 input tokens, 90% shared prefix. Inspect cache-aware serving; show caching, affinity and batch changes, not merely a cache toggle. | Estimated TTFT about 13,214 → 78 ms; output 2,176 → 5,135 tokens/s; modeled compute remains $104/hour.                                                      |
| Off-peak consolidation | 12 req/s. Inspect consolidation, approve, and show green taking traffic before blue retires.                                                       | $104 → $88/hour, 15.4% lower steady-state cost with unchanged offered/completed throughput. Both pools cost money during overlap.                           |
| Qwen launch spike      | 27 req/s with Qwen receiving 50%. Show why cheaper candidates fail and the prewarmed elastic candidate passes.                                     | Cache/consolidation rejected; six-replica elastic profile passes near 78 ms and $168/hour. A successful optimization can increase cost to preserve service. |

Run `npm run demo:report --silent` to reproduce the full evidence without the dashboard. Save stdout as JSON for your presentation evidence. This is a reusable decision-engine entry point, not a manually curated savings chart.

For the Qwen scenario, compare reactive scaling: enable autoscaling and Run after reloading the preset. At 90 simulated seconds the initial unoptimized profile has eight replicas and a modeled $208/hour rate, but only about 70% cumulative offered-request SLO compliance because capacity arrived late. The fixed prewarmed/cached six-replica alternative passes the replay. This compares two whole policies; do not attribute all gains to scaling alone.

The replica matrix updates actual simulator state by model and hardware, including ready and warming counts. The rank inspector makes one Kimi serving copy visible as eight cooperating ranks across two modeled four-chip hosts. Scaling another Kimi replica reserves another complete group. EP shares ranks rather than multiplying GPU count. Inspect the separate TP8 and PD design studies; these do not modify the engine's capacity or claim network speedups.

## Three-minute flow

1. **Live fleet:** Start on the running fleet. Follow Gemma, Qwen and Kimi requests across H200, GB200, GB300 and TPU v7. Show replica counts, accelerator ranks and demand history. The demo uses simulated traffic.
2. **Optimization:** Choose Explore Astra optimizations, then Ask Astra to optimize. Wait for the real API response or open a saved Astra analysis with a matching baseline. Local replay results are labelled separately.
3. **Inspect:** Select a recommendation. Compare cost, first-token latency and output throughput against the identical baseline replay. Review Astra's reasoning and the exact deployment changes.
4. **Approve:** Approve the blue-green rollout. Watch warmup, canary, migration and drain on Live fleet. Both pools consume capacity during overlap; failed gates trigger rollback.
5. **Simulation:** After completion, choose Simulate new demand. The approved green profile remains active. Change intensity, request type, prefix reuse, concurrency and burstiness; watch routing, utilization, queues and context demand on the same fleet view. Model memory reservation is static; the context token budget is a proxy, not measured KV usage.
6. **Experiment again:** Choose Open experimentation lab to return to Optimization with this workload and active profile. Ask Astra for new recommendations. Changing workload invalidates prior approvals.

For a one-minute submission, use one scenario: problem → passing/rejected evidence → approve → traffic migration → measured-systems next step. Clearly identify only the contribution created during the event.

## Judging fit and current gap

The supplied participant guide gives equal weight to Astra in development, Astra in the project, live demo, and technicality. It explicitly excludes projects whose main feature is a dashboard. Lead with the optimization workflow and runnable observer, and show the software operating rather than static charts. Maintain the public repository and a record of original work.

The Astra analyst now supplies the in-project model use: show “Ask Astra to optimize,” the returned rationale and alternatives, the 36-point sweep scope, and saved analysis history. The API key must be configured as a server secret. Real API availability is account-dependent; failures remain visible rather than being replaced by fabricated AI explanations. Performance evidence is still simulated, and no production infrastructure is changed.
