# Lambda live Gemma experiment

Status (2026-09-08): deployed and inference-validated on Lambda instance
autopilot-gemma-a100, ubuntu@161.153.80.250, Arizona/us-west-2, one A100-SXM4-40GB.
Rental is $1.99/hour until the VM is terminated. No extra filesystem is attached.
Separate from the browser simulator and GKE-only ingestion contract; evidence is
not yet wired to the UI. Astra recommendations are blocked on OPENAI_API_KEY.

Health returned HTTP 200; a real prompt produced a coherent 35-token response.
A single synthetic repeated-prefix baseline trial completed 60/60 requests at
concurrency 4, 2.52885 completed RPS, mean latency 1.58108s and p95 2.91308s.
These are measured trial results, not a general performance claim or speedup.
No optimization has been applied. The active baseline uses max batch tokens 4096
because the original 2048 failed the multimodal loader's minimum budget check.
The checkpoint occupied 16.63 GiB during loading, before KV/runtime allocations.

On the VM, Docker container autopilot-gemma serves localhost:8000 and transient
systemd unit autopilot-agent collects evidence under /home/ubuntu/evidence/baseline.
The unit survives SSH disconnects but is not installed for reboot persistence.
An SSH tunnel from this task currently exposes localhost:18000 on the workstation.
Recreate it with `ssh -N -L 127.0.0.1:18000:127.0.0.1:8000 ubuntu@161.153.80.250`.

Target: one x86 A100 40GB VM with Docker/NVIDIA runtime. serving.json selects
the community cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit checkpoint at a pinned revision,
served with vLLM v0.28.0. Its compressed-tensors metadata specifies INT4 weights
and mixed unquantized layers; activations remain BF16. This is not Google's BF16
checkpoint, and hardware fit/kernel compatibility still need runtime validation.
AWQ/Marlin support Ampere generally; that does not validate this specific MoE.
The Hugging Face API reports this checkpoint ungated. Verify the VM driver before
pulling/starting the image. Do not use native FP8 W8A8 as an A100 fallback.

Set OPENAI_API_KEY in the agent environment and HF_TOKEN if downloading the model
requires authentication. Never commit secrets. Copy this directory to the VM:

```sh
bash start.sh
# In another SSH session, after /health succeeds:
curl --fail http://127.0.0.1:8000/health
python3 traffic.py --requests 60 --concurrency 4 --label baseline --output evidence/baseline/traffic.json
```

The baseline deliberately disables prefix caching for a repeated-prefix experiment;
label this as an experimental configuration, not the default vLLM configuration.
Traffic prompts are synthetic; inference and telemetry are real. The agent writes
evidence/state.json, metrics.jsonl, recommendation.json, and dated recommendations.
Recommendations contain their exact observed windows and declared configuration.

Metrics polling is every ten seconds, pausing during synchronous Astra calls.
Rates use actual elapsed time. At least twenty completions qualify for analysis;
API attempts are spaced by at least two minutes and capped at ten per process.
Restart resets that cap. API charges are additional to VM rental. Without a key,
collection continues and analysis-status.json reports missing_openai_key.

Means are not p95; completed throughput is not incoming demand. Suggestions are
untested hypotheses. This service does not apply changes or claim measured gains.

Inference is localhost-only; use SSH forwarding. start.sh starts a persistent
Gemma container and a foreground agent after a health check. Run it once; restart only the agent with
python3 live_agent.py --config serving.json --output evidence/baseline. Add supervision for
unattended use. docker stop autopilot-gemma stops serving, but the Lambda VM keeps
billing until terminated in Lambda. Export evidence first.

For the comparison, preserve baseline evidence and Astra's actual recommendation.
Create a second configuration with only its proposed setting changed. Stop the
foreground collector, archive container logs, stop/remove only autopilot-gemma,
then launch with `bash start.sh --config candidate.json --output evidence/candidate`.
Run the same request count, prompts, concurrency, context limit, and token cap;
record cold versus warm cache conditions. traffic.json includes failures, mean and
nearest-rank p95 request latency, and successful completions per elapsed second.
Repeat trials before claiming an improvement; do not hide regressions or failures.
The candidate is only "Astra recommended" after an actual recorded Astra response,
and only "optimized" after a measured improvement. A 4-bit vs 8-bit checkpoint
experiment additionally requires identical quality checks and kernel compatibility.
BF16 weights cannot be the all-GPU baseline on a 40GB A100.

Checks: python3 -m unittest -v test_live_agent.py, bash -n start.sh,
python3 launch.py --dry-run, and Python compilation. These do not validate a GPU deployment.
