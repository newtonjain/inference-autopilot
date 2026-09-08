# Build record

Built in this task from the Sites starter. The original contribution is the inference simulation engine, Gemma deployment scenarios, approval workflow, trace format and import/export, operator UI, and invariant tests. Generated Sites and Shadcn code are starter dependencies rather than original work.

The main coding agent implemented the application. A parallel review agent challenged simulation design and reviewed correctness without editing the Site. Review found cache-length accounting, delimiter-safe cache keys, empty-evidence approval, fractional first-token timing, and stale async imports; fixes and regression tests were added.

This is a simulation milestone. Live Astra integration, GPU benchmarking, cloud provisioning, and real customer execution have not been implemented. No customer data or event access information is included.

## Multi-model fleet iteration

The main agent integrated the fleet console, workload controls, profile inspection, two-pool session accounting, and release. Three delegated agents contributed the fleet simulation engine and tests, rollout controller and tests, and routing/hardware visualization. The rollout agent also reviewed and strengthened live verification and rollback accounting. The earlier request-level lab remains at `/lab`.

This iteration adds independent blue/green simulation pools, resource warmup, actual split demand, conservative frozen-placement evidence, heterogeneous compatibility limits, and full overlap charging. It still has no cloud execution or live model inference.
