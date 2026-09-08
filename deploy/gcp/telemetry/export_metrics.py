#!/usr/bin/env python3
"""Read-only, fixed-query GCP Managed Prometheus snapshot exporter (stdlib only)."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

MODELS = ('gemma', 'qwen', 'kimi')
MAX_BODY = 1_000_000
SCOPE = 'https://www.googleapis.com/auth/monitoring.read'


class ExportError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ExportError('Unexpected redirect; export stopped.')


def read_json(url, headers):
    # Fixed URLs only; avoid forwarding credentials through environment HTTP proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=20) as response:
            body = response.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            raise ExportError('Response exceeds size limit.')
        return json.loads(body)
    except (urllib.error.URLError, OSError, ValueError):
        # Never emit response bodies, URLs, credentials, or upstream error details.
        raise ExportError('Cloud request failed; check identity, metric availability and IAM.') from None


def validate_config(config):
    if not isinstance(config, dict) or set(config) != {'projectId', 'location', 'cluster', 'namespace', 'models'}:
        raise ExportError('Config must contain projectId, location, cluster, namespace and models only.')
    if not isinstance(config['projectId'], str) or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', config['projectId']):
        raise ExportError('Invalid project ID (use the ID, not the numeric project number).')
    for key in ('location', 'cluster', 'namespace'):
        if not isinstance(config[key], str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', config[key]):
            raise ExportError('Invalid scope label.')
    mapping = config['models']
    if not isinstance(mapping, dict) or not mapping or not set(mapping).issubset(MODELS):
        raise ExportError('Map one or more known model IDs explicitly.')
    values = list(mapping.values())
    if any(not isinstance(v, str) or not v or len(v) > 200 or any(ord(c) < 32 for c in v) for v in values):
        raise ExportError('Invalid exact model_name label.')
    if len(set(values)) != len(values):
        raise ExportError('A serving model name cannot map to multiple simulation models.')
    return config


def queries(config, name, minutes):
    labels = {key: config[key] for key in ('location', 'cluster', 'namespace')}
    labels['project_id'] = config['projectId']
    labels['model_name'] = name
    selector = '{' + ','.join(k + '=' + json.dumps(v) for k, v in labels.items()) + '}'
    def rate(metric):
        return f'sum(rate({metric}{selector}[{minutes}m]))'
    def mean(metric):
        return f'({rate(metric + "_sum")}) / ({rate(metric + "_count")})'
    return {
        'rps': rate('vllm:request_success_total'),
        'inputTokens': mean('vllm:request_prompt_tokens'),
        'outputTokens': mean('vllm:request_generation_tokens'),
        'ttftMs': f'1000 * ({mean("vllm:time_to_first_token_seconds")})',
        'tokenMs': f'1000 * ({mean("vllm:inter_token_latency_seconds")})',
        'queue': f'sum(vllm:num_requests_waiting{selector})',
        'prefixHitRate': f'({rate("vllm:prefix_cache_hits_total")}) / ({rate("vllm:prefix_cache_queries_total")})',
    }


def scalar(result):
    if not isinstance(result, dict) or result.get('status') != 'success' or result.get('warnings'):
        raise ExportError('Query failed or returned partial-data warnings.')
    data = result.get('data', {})
    if data.get('resultType') != 'vector' or not isinstance(data.get('result'), list):
        raise ExportError('Unexpected query result type.')
    rows = data['result']
    if not rows:
        return None
    if len(rows) != 1 or rows[0].get('metric') != {}:
        raise ExportError('Query returned ambiguous non-aggregate series.')
    try:
        value = float(rows[0]['value'][1])
    except (TypeError, ValueError, KeyError, IndexError):
        raise ExportError('Invalid metric sample.') from None
    return value if math.isfinite(value) and value >= 0 else None


def export(config, minutes=5, now=None, request=read_json):
    validate_config(config)
    if type(minutes) is not int or not 1 <= minutes <= 60:
        raise ExportError('Window must be an integer between 1 and 60 minutes.')
    now = now or datetime.now(timezone.utc)
    end = now.isoformat().replace('+00:00', 'Z')
    token_url = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?' + urllib.parse.urlencode({'scopes': SCOPE})
    token = request(token_url, {'Metadata-Flavor': 'Google'}).get('access_token')
    if not isinstance(token, str) or not token or '\n' in token or '\r' in token:
        raise ExportError('Workload identity did not return a token.')
    base = f'https://monitoring.googleapis.com/v1/projects/{config["projectId"]}/location/global/prometheus/api/v1/query'
    models = []
    for model, name in config['models'].items():
        row = {'model': model}
        for field, query in queries(config, name, minutes).items():
            url = base + '?' + urllib.parse.urlencode({'query': query, 'time': end, 'timeout': '15s'})
            row[field] = scalar(request(url, {'Authorization': 'Bearer ' + token}))
            if field == 'prefixHitRate' and row[field] is not None and row[field] > 1:
                row[field] = None
        models.append(row)
    return {'schemaVersion': 1, 'kind': 'inference-autopilot.telemetry',
            'source': 'gcp-managed-prometheus', 'rateKind': 'completed',
            'latencyKind': 'mean', 'observedAt': end,
            'startTime': (now - timedelta(minutes=minutes)).isoformat().replace('+00:00', 'Z'),
            'endTime': end, 'models': models}


def push_snapshot(snapshot, url, token):
    parsed = urllib.parse.urlparse(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path != '/api/telemetry/ingest'):
        raise ExportError('Ingest URL must be HTTPS with path /api/telemetry/ingest and no credentials or query.')
    if not token or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise ExportError('Set AUTOPILOT_INGEST_TOKEN to a valid ingestion credential.')
    request = urllib.request.Request(url, data=json.dumps(snapshot, allow_nan=False).encode(),
                                     headers={'Authorization': 'Bearer ' + token,
                                              'Content-Type': 'application/json'}, method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            if response.status != 200 and response.status != 201 and response.status != 202:
                raise ExportError('Ingestion rejected the snapshot.')
    except (urllib.error.URLError, OSError, ValueError):
        raise ExportError('Ingestion failed; check the configured endpoint and credential.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--ingest-url', default=os.environ.get('AUTOPILOT_INGEST_URL'))
    parser.add_argument('--window-minutes', default=5, type=int)
    args = parser.parse_args()
    try:
        if not args.output and not args.ingest_url:
            raise ExportError('Provide --output or AUTOPILOT_INGEST_URL.')
        if args.config.stat().st_size > 16_384:
            raise ExportError('Config exceeds size limit.')
        snapshot = export(json.loads(args.config.read_text()), args.window_minutes)
        # Exclusive creation avoids overwriting an existing snapshot or following a symlink.
        if args.output:
            with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
                json.dump(snapshot, stream, indent=2, allow_nan=False)
                stream.write('\n')
        if args.ingest_url:
            push_snapshot(snapshot, args.ingest_url, os.environ.get('AUTOPILOT_INGEST_TOKEN', ''))
    except (ExportError, OSError, ValueError) as error:
        print(str(error) if isinstance(error, ExportError) else 'Cannot read config or create output file.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
