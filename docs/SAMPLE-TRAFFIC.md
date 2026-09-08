# Two-day sample traffic and Astra

The checked-in `public/data/synthetic-fleet-48h.json` contains 576 contiguous five-minute aggregate windows, September 5–7, 2026 UTC. All traffic is generated, not captured from a customer. It contains offered request rates, token lengths, prefix reuse, burstiness and model mix; no prompts, personal identifiers or credentials. Regenerate with `node scripts/generate-sample-traffic.mjs`; this also updates the typed copy consumed by the application.

## Demo

1. Open Optimization and click **Analyze with Astra**. The two-day dataset is selected automatically on the server; there are no sample or phase controls in the demo UI.
2. Astra receives all 48 hourly summaries plus evidence for three distinct deployment strategies. The replay workload uses the whole history's time-weighted request rate and request-weighted token lengths and model mix.
3. Inspect cost, first-token latency and throughput against the same baseline, then approve a feasible blue-green rollout.
4. The server must have OPENAI_API_KEY configured and the user must be signed in. Failures are shown; there is no silent local-replay substitute for an Astra analysis.

All comparison metrics are from identical 90-second representative-period replays, not a continuous two-day simulation or measured cloud performance. Equal delivered throughput can be correct when demand is below capacity. Two days provide daily variation, not evidence of weekly/monthly seasonality. Actual model and accelerator compatibility still requires verification.

## Production attachment

The UI consumes workload aggregates rather than cloud-specific logs. The existing GKE Helm observer discovers replica placement; the Managed Prometheus collector reads serving metrics using Workload Identity. Its existing `/api/telemetry/ingest` endpoint accepts the separate fresh GCP window contract. It does not yet accept this historical fixture format.

For historical production analysis, a customer-side collector must normalize GCP Monitoring/Managed Prometheus, AWS CloudWatch, or OpenTelemetry windows into a versioned historical contract. Preserve provider, cluster/namespace scope, observed time, missing values and offered-versus-completed rate semantics. Store aggregated windows in the customer's time-series store, then query a bounded history for analysis. Deploy the collector as a Kubernetes CronJob/Deployment with monitoring read permissions; keep the analyst API key server-side and cloud actuation behind a separate approval-gated controller.

The supplied historical path currently accepts only the fixed synthetic dataset ID and phase; it cannot read arbitrary files or query a production historical store. The live GCP snapshot/telemetry path remains separate and observe-only. The private hosted site's authentication transport and a real cluster connection are still required for automatic collection.
