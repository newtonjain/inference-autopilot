#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s observer -p 'test_*.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s telemetry -p 'test_*.py'
python3 -m json.tool examples/serving-intents.json >/dev/null
if command -v helm >/dev/null 2>&1; then
  helm lint chart --set image=example.invalid/observer:validation
  helm template observer chart --namespace autopilot --set image=example.invalid/observer:validation >/dev/null
  helm template observer chart --namespace autopilot --set image=example.invalid/observer:validation --set monitoring.enabled=true >/dev/null
else
  echo 'Helm unavailable: chart rendering NOT validated. Install Helm and rerun.' >&2
  exit 1
fi
