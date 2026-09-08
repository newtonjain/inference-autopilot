# Astra deployment decision service

The application now has an actual server-side OpenAI Responses API integration. The model ID is `gpt-6-astra`, using structured output, medium reasoning, a bounded output budget and a 60-second timeout. The request uses `store:false`. This does not mean third-party API data has no applicable service retention policy. [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Decision path

1. Save a workload or upload a normalized GCP telemetry window.
2. Run the complete finite supported grid: up to three placement layouts × four batching values × three valid cache/affinity combinations. Placements are frozen for every 90-second replay; headroom does not receive fabricated performance credit when autoscaling is off.
3. Send numeric workload facts and candidate measurements to Astra. Arbitrary profile names, prompt text, trace bodies and unrelated labels are stripped.
4. Astra selects up to three existing feasible IDs and supplies a bottleneck summary, reasons, risks and data gaps. An empty model recommendation remains empty; no silent deterministic substitution is presented as AI output.
5. The server rejects invented IDs, infeasible choices, malformed outputs, refusals and incomplete responses. It saves the result against the authenticated user.
6. In simulation, Inspect checks exact current profile/workload context again before allowing a human-approved blue-green rollout. Observed-telemetry recommendations cannot be applied to cloud infrastructure by this app.

“Full sweep” is limited to the declared grid. It does not search every model precision, kernel, distributed parallelism arrangement, placement permutation or cloud SKU. Throughput, fit, pricing and warmup remain a synthetic model. Actual production rollout needs calibrated benchmarks and a separate approved cloud actuator.

## Secrets and access

Set `OPENAI_API_KEY` as a hosted secret, never a client environment variable or committed file. Local development may use an ignored `.env.local`; do not print the key or include it in reports. The Sites deployment is private. API routes require dispatcher-provided user identity and scope every database query to that user. Browser writes require the same origin. Do not run these handlers behind a server that trusts caller-supplied identity headers; the hosting dispatcher must strip and establish them.

D1 holds saved workloads, telemetry windows and completed/failed analyses. Schema migrations are generated with Drizzle and shipped through Sites. Each request uses bound SQL parameters. Analysis is limited to one in-flight request per user, at least 60 seconds apart, and 20 attempts per rolling hour. Failures remain failed records. Stored history is not automatically approved when reviewed later.

## Telemetry and on-the-fly analysis

The GCP exporter queries Managed Prometheus with Workload Identity and explicit model/cluster mappings. Upload its JSON on the Optimization screen, or use the authenticated ingestion API after configuring transport. Metric names are exporter-version dependent; missing measurements stay null and incomplete/stale windows cannot silently become replay demand.

The initial exporter reports **completed request rate** and **mean latency**, not offered ingress and p95. The replay uses completed throughput as an explicitly labeled lower-bound proxy. This can underestimate overloaded demand. Observability-backed choices remain review-only until router ingress, histogram SLOs, device telemetry, prices and serving rates are calibrated.

“Watch new telemetry” polls every 15 seconds while the Optimization screen remains open and requests Astra analysis for a new window at most once a minute, subject to the hourly cap. It is opt-in and consumes OpenAI API usage. It is not an unattended server scheduler and stops when the screen closes. A GCP CronJob can export telemetry independently; continuous background analysis requires a separately operated job runner.

## Collector tokens and private transport

The Optimization panel can issue or rotate an ingest-only token. The database retains only its SHA-256 hash, bound to the current user. The raw token is shown once and belongs in the collector's Kubernetes Secret. `/api/telemetry/ingest` authenticates that token and stores only validated aggregates. Tokens do not grant workload read, model-call or deployment privileges.

The private Sites dispatcher also requires authenticated access. **An application token alone does not bypass that outer gate.** Before an external GCP CronJob can push, establish a supported authenticated/private transport or host the ingress service in the customer's controlled backend. Do not make the dashboard public just to enable ingestion. Manual signed-in upload is available now and needs no bridge. Neither a real GCP account nor that transport has been connected by this implementation.

## Local validation

Use Node22+, `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. For local D1, execute each generated SQL migration against the local DB binding with Wrangler; do not modify tables at request time. The Sites local sign-in route supplies the development identity. Python exporter tests and Helm templates run independently. Mocked tests cover refusal, incomplete output, invented candidates, data filtering and model selection. A live verification must use the real configured key; simulated tests alone do not establish API/model access.

See [two-day sample traffic](SAMPLE-TRAFFIC.md) for historical synthetic inputs and the provider adapter boundary.
