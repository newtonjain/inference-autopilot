# Attach Inference Autopilot to GKE

The dashboard supports simulation, persisted telemetry snapshots and server-side Astra recommendations; cloud changes remain observe-only. `deploy/gcp` adds a runnable **read-only inventory observer**, an optional metrics collection manifest, and explicit serving-planning examples. It does not create a cluster, provision accelerators, change an existing model endpoint, install an inference engine, or grant permission to resize workloads. No Google credentials or model API keys are included.

## Existing deployment: first attachment

Install one observer release per inference namespace. The chart creates a service account, a namespaced Role with only `list pods`, a RoleBinding, a CPU Deployment and an internal Service. It reads pod placement, requested GPU/TPU limits, readiness and a narrow allowlist of topology labels. It exports no environment variables, command arguments, arbitrary annotations, secret objects, logs or prompt bodies. Kubernetes RBAC still permits reading full pod objects in that namespace; use a dedicated inference namespace. There is no cluster-wide node access: hardware labels are operator declarations until a separately authorized inventory adapter verifies them.

Build the provided image into your own registry; replace the placeholder with the resulting immutable digest. Run these commands yourself against your selected development cluster; they are not executed by this project:

```sh
# From simulation/; requires Docker, gcloud, kubectl and Helm.
docker build -t REGION-docker.pkg.dev/PROJECT/REPOSITORY/observer:0.1.0 deploy/gcp/observer
# Authenticate Docker to your Artifact Registry, then push and obtain the digest.
gcloud container clusters get-credentials CLUSTER --location LOCATION --project PROJECT
kubectl config current-context
# The existing inference namespace must already exist.
helm template inference-observer deploy/gcp/chart --namespace autopilot \
  --set watchNamespace=inference \
  --set image=REGION-docker.pkg.dev/PROJECT/REPOSITORY/observer@sha256:DIGEST
helm upgrade --install inference-observer deploy/gcp/chart \
  --namespace autopilot --create-namespace \
  --set watchNamespace=inference \
  --set image=REGION-docker.pkg.dev/PROJECT/REPOSITORY/observer@sha256:DIGEST
kubectl -n autopilot rollout status deployment/inference-observer
kubectl -n autopilot port-forward service/inference-observer 8080:8080
# In a second terminal:
curl --fail http://127.0.0.1:8080/snapshot > inventory.json
```

The placeholder image deliberately fails until supplied. The operator installing the chart needs permission to create the namespaced RoleBinding; the observer itself cannot write any resources. The ingress NetworkPolicy admits only same-namespace pods labelled `autopilot/client: "true"`, assuming network-policy enforcement is enabled. Local port forwarding uses Kubernetes authorization. There is no public ingress, CORS configuration, authentication gateway or external upload. Before adding an in-cluster client, configure authenticated transport; do not expose the snapshot Service to the internet. Egress remains open to accommodate cluster-specific API/DNS endpoints; production network policy should restrict those destinations using the cluster's actual control-plane addressing.

The snapshot contract is `{schemaVersion:1, kind:"inference-autopilot.gke-snapshot", source:"gke-observer", ready, mode:"observe-only", observedAt, pods, errors}`. The provided `examples/snapshot.json` is synthetic and explicitly marked `source:"example"`. Each pod contains `name`, `namespace`, `node`, `phase`, `ready`, selected `labels` and per-container `accelerators`. The endpoint returns 503 when polling fails; an older inventory may remain present but must be treated as stale. Polling is every 15 seconds. Group pods by `autopilot/model` and `autopilot/replica`, not by pod count: a distributed replica spans multiple worker pods. Recommended optional labels are `autopilot/hardware`, `autopilot/group`, `autopilot/role` (prefill/decode/combined), and `autopilot/tp`, `autopilot/pp`, `autopilot/ep`, `autopilot/dp`. Labels are declarations, not proof of the engine's runtime configuration. The dashboard supports manual local snapshot import, separate from simulated traffic. It is not a live connection: feed snapshots through an authenticated ingestion adapter before replacing simulation data. All TP × PP member pods must share the same `autopilot/replica` label; separate prefill/decode roles are separate serving copies. All members ready and sufficient reserved chips identify a ready candidate, not proof that runtime ranks formed a working distributed group.

## Metrics and decision hooks

Enable GKE Managed Service for Prometheus separately, then set `monitoring.enabled=true`. The optional PodMonitoring selects only explicitly matching serving pods in the watched namespace and a named metrics port; it never discovers arbitrary URLs. Its metric-name allowlist covers serving queue, token counters, cache hits and latency histogram families. Verify actual exporter names/version, allowed labels and cardinality before enabling. Histogram buckets permit p95 calculations; average token counts cannot establish p95 latency. Metrics go to your managed monitoring system, not this observer or the public dashboard. [Managed collection setup](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/setup-managed).

| Hook                          | Required observations                                                                                              | Why it matters                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Router/OpenTelemetry          | Model/version, arrival rate, queue delay, status, concurrency, tenant class and request token counts               | Separates traffic changes from serving regressions; exclude text and identifiers       |
| Serving `/metrics`            | TTFT/ITL histograms, running/waiting requests, KV occupancy, prefix hit/query counters, prefill/decode token rates | Distinguishes prefill, decode, cache and admission bottlenecks                         |
| GPU/TPU telemetry             | Device utilization, memory, interconnect bandwidth and errors                                                      | High GPU utilization alone does not prove an efficient serving fleet                   |
| Runtime configuration adapter | Precision, TP/PP/EP/DP, rank membership, batch policy, KV connector and artifact revision                          | Converts a pod inventory into actual deployment topology                               |
| GKE scheduling/node inventory | Machine types, topology domains, allocatable devices, pending reasons and reservations                             | Tests whether a proposed replica can be placed; requires additional scoped permissions |
| Billing export and quotas     | Actual VM/reservation/egress costs, commitments and regional availability                                          | Replaces illustrative chip prices with billable node costs                             |

The supplied [telemetry query adapter](TELEMETRY.md) uses Workload Identity Federation for GKE and narrowly scoped Cloud Monitoring read permissions. It exports aggregate windows for authenticated upload or an ingestion transport configured for the private site. The current observer uses only its projected Kubernetes service-account token and requires no Google IAM role. Avoid JSON service-account keys. Enabling Workload Identity on an existing Standard node pool can affect existing applications, so follow the documented migration procedure. [Workload Identity setup](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity).

## Hardware, distributed replicas and fleet boundaries

A Kubernetes cluster can contain heterogeneous accelerator node pools; a Google Cloud fleet is a management grouping of clusters. Installing this chart attaches to an existing namespace. It does not register clusters into a fleet or turn VMs outside GKE into Kubernetes nodes. For multiple existing clusters, install one observer per namespace and aggregate with stable project/location/cluster IDs. Register clusters separately when centralized fleet management is wanted. [Fleet registration](https://docs.cloud.google.com/kubernetes-engine/fleet-management/docs/register/gke).

For a new environment, first select region, quota/reservations, supported GKE release, VPC/private control-plane access, CPU system pool and accelerator machine families. GPU pools need drivers and runtime-compatible GPU networking; TPU pools need a supported slice topology and TPU-compatible engine. Use infrastructure-as-code owned by the customer for provisioning. This repository deliberately does not apply speculative accelerator reservations.

The simulation's eight-chip GB300 group represents a serving allocation, **not one GCP VM or a complete NVL72 rack**. A planning mapping to four-GPU A4X Max hosts is two physical hosts per eight-chip group; check currently supported machine shapes and availability. TP4 × PP2 spans those two hosts: tensor collectives stay within a host and pipeline activations cross hosts. EP can redistribute experts within participating ranks, and is not automatically an additional chip-count multiplier. DP creates complete independent model-serving groups; scaling one worker pod is not scaling one whole replica. [GKE GPU machine families](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gpus).

PD disaggregation requires separate full-model prefill/decode worker pools, a supported KV-transfer connector, cache-format compatibility, explicit routing and measured transfer overhead. It may hurt short requests or expensive cross-zone networking. A real rollout must allocate complete worker groups with gang/coordinated scheduling, establish readiness for every rank, warm the model/KV path, canary at the router, gate on measured SLOs, drain requests and retain rollback capacity. The observer does not implement any of these writes. Use a separately permissioned, approval-gated controller for them.

TPUs use `google.com/tpu` resources and supported slice topology. Multi-host TPU slices scale as a topology unit; do not treat each TPU host as an independent GPU replica or reuse CUDA/NCCL launch flags. [TPUs in GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/tpus), [TPU deployment guide](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/tpus).

`deploy/gcp/examples/serving-intents.json` is reviewable planning data, not executable Kubernetes manifests or verified model launch recipes. It separates physical hosts, chips, full replicas and runtime-specific parallelism. Gemma, Qwen and Kimi support, weight format, licenses, KV/workspace memory and measured engine compatibility must be verified before serving. "Gaich3" has no selected artifact here; resolve its exact identity before adding a runtime profile.

## Validation and next delivery

Run `sh deploy/gcp/validate.sh` locally. It tests sensitive-field filtering and GPU/TPU snapshot handling, validates the planning JSON and renders both chart variants when Helm is installed. [Helm rendering](https://helm.sh/docs/helm/helm_template/) does not validate admission policies, CRD availability, image pull access or cloud permissions. Before a real install, run server-side dry-run on the rendered YAML against the target development cluster and verify RBAC with `kubectl auth can-i` for the observer identity. Then check `/readyz`, snapshot accuracy and exporter metrics against the real serving fleet.

Account-scoped aggregate window storage, an authenticated ingestion route and Astra-assisted replay are implemented; see [Astra integration](ASTRA.md). The next production increment is connecting the private-site authenticated collector transport, a durable time-series backend and verified runtime topology discovery. After evidence gates work, add a separate write controller with idempotent plans, explicit approvals, audit retention, quota and warm-up checks, guarded routing changes, abort and rollback. No autonomous cloud actuation is shipped by this scaffold.
