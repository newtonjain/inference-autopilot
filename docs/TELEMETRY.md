# GCP telemetry into the optimizer

The exporter in `deploy/gcp/telemetry/` queries real Google Cloud Managed Service for Prometheus data using seven fixed PromQL expressions for each explicitly mapped model. It runs once, writes a snapshot for dashboard upload, optionally pushes it to the authenticated ingestion endpoint, and exits. The optional CronJob repeats that every five minutes. No cloud resource was provisioned or queried during implementation.

## Configure the source

1. Enable managed collection and scrape the vLLM serving endpoints into your project's Managed Prometheus workspace. The existing observer chart can enable its optional PodMonitoring; confirm that the target metrics actually exist using Cloud Monitoring. Do not scrape multiple copies of the same serving counters (for example both worker and gateway exports).
2. Give a dedicated Kubernetes service account `roles/monitoring.viewer` on the project being queried using Workload Identity Federation for GKE. The example names that existing account `autopilot-monitoring-reader` in namespace `inference`. This exporter needs no Kubernetes write permission and no Google service account JSON key. It requests a short-lived metadata token with the `monitoring.read` OAuth scope. IAM permissions remain the actual access boundary.
3. Copy `deploy/gcp/telemetry/model-map.example.json` to an operator-owned config. Replace every placeholder with the exact `model_name` label emitted by your running serving engine. Supply the actual project ID, cluster, location and namespace. Remove models that are not deployed. One exact serving name cannot map to two dashboard models. Names and configs are not guessed from a model catalog.
4. Run the exporter inside that GKE workload identity context. A local laptop without the GKE metadata server will fail authentication by design.

```sh
python /app/export_metrics.py --config /config/model-map.json --output /tmp/telemetry.json
```

The output file is newly created with mode `0600`; existing files are not overwritten. Transfer it through your own authorized channel and use the dashboard's telemetry import. The file contains aggregate metrics and model IDs, not prompts, traces, credentials or raw series labels.

Google documents the [Managed Prometheus query endpoint](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/query-api-ui) and [Workload Identity setup](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity). The exporter fixes the Google host and query path, rejects redirects, caps response sizes, and never prints tokens or upstream response bodies.

## Continuous ingestion

Build `deploy/gcp/telemetry/Dockerfile` with `deploy/gcp/telemetry` as its context and push the image to your own Artifact Registry. Replace the placeholders in `cronjob.example.yaml` with that image and your deployed Autopilot host. It is an optional manifest, not installed by the existing Helm chart.

Create the ConfigMap from your completed model map:

```sh
kubectl -n inference create configmap autopilot-telemetry-model-map --from-file=model-map.json=/path/to/model-map.json
```

Provide an existing Secret `autopilot-telemetry-ingest` with key `token`. Its value must match the ingestion credential configured on the Autopilot server. Use your secret manager or a protected file; never place it in committed YAML, command arguments or the model-map JSON. The pod reads `AUTOPILOT_INGEST_TOKEN` from that Secret and `AUTOPILOT_INGEST_URL` from the manifest. For a one-off job, `--ingest-url` can replace the URL environment variable. Only HTTPS URLs ending exactly in `/api/telemetry/ingest` are accepted, with no URL credentials, query or fragment. Redirects are refused. The credential is sent only to the operator-selected endpoint.

Apply the manifest only after creating the Workload Identity service account, ConfigMap, Secret and server ingestion configuration. Jobs use a read-only filesystem and non-root identity. Network policy must allow the GKE metadata server, Google Monitoring HTTPS and the configured Autopilot HTTPS endpoint. The manifest grants no cluster permissions and contains no API keys.

## What the snapshot means

The JSON root contains `schemaVersion: 1`, `kind: "inference-autopilot.telemetry"`, `source: "gcp-managed-prometheus"`, `rateKind: "completed"`, `latencyKind: "mean"`, UTC `observedAt`, `startTime`, `endTime`, and a `models` array. Each row contains its model ID and these nullable numeric fields:

| Field                         | Meaning                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `rps`                         | Five-minute rate of successfully completed requests, using `request_success_total`. **Not incoming demand**: it can fall under saturation. |
| `inputTokens`, `outputTokens` | Mean per-request prompt/generation token counts from their histogram sums and counts.                                                      |
| `ttftMs`, `tokenMs`           | Mean TTFT and inter-token latency, derived from histogram sums/counts, converted to milliseconds. **Not p95 or SLO pass rates.**           |
| `queue`                       | Current aggregate waiting requests; an instantaneous gauge rather than a window mean.                                                      |
| `prefixHitRate`               | Cached-token hits divided by queried tokens over the window; not the fraction of requests with shared prefixes.                            |

Queries aggregate only within the explicitly selected project/location/cluster/namespace/model name. The evaluation timestamp is shared across every query. `observedAt` records the requested evaluation time, not proof that every underlying series is fresh. Prometheus lookback behavior applies to the queue gauge. Missing, negative or non-finite samples become `null`; invalid cache fractions become `null`. Missing metrics never silently become zeros. Query errors, partial-data warnings and ambiguous returned series abort the whole export.

Metric names target the currently documented [vLLM production metrics](https://docs.vllm.ai/en/stable/usage/metrics/), including Prometheus `_total` counter suffixes. Other engines and older versions may need a separately reviewed fixed adapter. A TPU deployment that does not expose these vLLM metrics will produce missing values, not inferred measurements.

## Boundaries and next adapters

This snapshot adds real aggregate evidence to recommendation analysis. It is not a traffic replay or a calibrated hardware benchmark. Ingress rates/errors, per-request distributions, accelerator utilization, topology, serving flags, and billing are additional sources required before claiming production optimization benefits. No raw traces or customer prompts are exported. Histogram means cannot establish a percentile SLO, and successful throughput cannot establish offered demand. Keep deterministic feasibility checks and operator approval when applying any AI recommendation.

The server may continuously store pushed snapshots, but this exporter does not execute model calls or mutate cloud deployments. Scheduled AI analysis and rollout authorization belong to separate server/controller components.

Run the exporter tests without credentials or network:

```sh
python3 -m unittest discover -s deploy/gcp/telemetry -p 'test_*.py'
```

## Hosted application wiring

On Optimization, import the JSON to persist it in your signed-in account, then select “Use latest observed telemetry” and ask Astra to optimize. A collector token can be generated in the same panel; the service stores its hash and binds it to the user. The private Sites sign-in gate is separate: an app token by itself cannot authenticate an external CronJob through that outer gate. Use a supported authenticated transport or customer-owned ingress backend before enabling push. Manual signed-in upload is the ready path until that bridge exists. See [Astra service boundaries](ASTRA.md).
