# Two-day sample traffic and Astra

The checked-in `public/data/synthetic-fleet-48h.json` contains 576 contiguous five-minute aggregate windows, September 5–7, 2026 UTC. All traffic is generated, not captured from a customer. It contains offered request rates, token lengths, prefix reuse, burstiness and model mix; no prompts, personal identifiers or credentials. Regenerate with `node scripts/generate-sample-traffic.mjs`; this also updates the typed copy consumed by the application.

## Demo

1. Open Optimization, choose overnight, shared-prefix peak, Qwen surge or mixed traffic.
2. Run Optimization for three distinct representative profiles: cache-aware serving, consolidation, and pre-warmed burst capacity. An internal 27-point sweep picks one variant per placement strategy; batch 64 is excluded because this simulator caps batching efficiency at 32.
3. Choose Analyze 48-hour sample with Astra for a real server-side OpenAI API request. It sends 48 hourly demand summaries and the selected period's representative replay evidence. The server must have OPENAI_API_KEY configured and the user must be signed in. API failures are shown; local replay is never labeled an Astra response.
4. Inspect, approve a feasible profile, and watch the simulated blue-green rollout. The analysis is bound to the profile and selected workload. Fewer than three AI recommendations is valid when Astra rejects alternatives or gates fail.

All comparison metrics are from identical 90-second representative-period replays, not a continuous two-day simulation or measured cloud performance. Equal delivered throughput can be correct when demand is below capacity. Two days provide daily variation, not evidence of weekly/monthly seasonality. Actual model and accelerator compatibility still requires verification.

## Production attachment

The UI consumes workload aggregates rather than cloud-specific logs. The existing GKE Helm observer discovers replica placement; the Managed Prometheus collector reads serving metrics using Workload Identity. Its existing `/api/telemetry/ingest` endpoint accepts the separate fresh GCP window contract. It does not yet accept this historical fixture format.

For historical production analysis, a customer-side collector must normalize GCP Monitoring/Managed Prometheus, AWS CloudWatch, or OpenTelemetry windows into a versioned historical contract. Preserve provider, cluster/namespace scope, observed time, missing values and offered-versus-completed rate semantics. Store aggregated windows in the customer's time-series store, then query a bounded history for analysis. Deploy the collector as a Kubernetes CronJob/Deployment with monitoring read permissions; keep the analyst API key server-side and cloud actuation behind a separate approval-gated controller.

The supplied historical path currently accepts only the fixed synthetic dataset ID and phase; it cannot read arbitrary files or query a production historical store. The live GCP snapshot/telemetry path remains separate and observe-only. The private hosted site's authentication transport and a real cluster connection are still required for automatic collection.
