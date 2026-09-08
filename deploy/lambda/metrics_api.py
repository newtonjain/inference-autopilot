#!/usr/bin/env python3
"""Authenticated, read-only evidence endpoint. Never serves arbitrary files."""
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path

ROOT = Path('/home/ubuntu/evidence')
TOKEN = os.environ['LIVE_GPU_TOKEN']


def read(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def snapshot():
    active = read(ROOT / 'active.json', {'profile': 'baseline'})['profile']
    if active not in ('baseline', 'candidate'):
        active = 'baseline'
    runs = []
    for profile in ('baseline', 'candidate'):
        for path in sorted((ROOT / profile).glob('traffic*.json')):
            data = read(path, {})
            if 'summary' in data:
                runs.append({'profile': profile, 'file': path.name, **data['summary']})
    return {
        'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'hardware': '1 × NVIDIA A100-SXM4 40GB', 'hourlyUsd': 1.99,
        'model': 'Gemma 4 26B-A4B IT · AWQ 4-bit', 'activeProfile': active,
        'live': read(ROOT / active / 'state.json', {'status': 'unavailable'}),
        'configurations': {p: read(ROOT / p / 'configuration.json') for p in ('baseline', 'candidate')},
        'recommendation': read(ROOT / 'baseline' / 'recommendation.json'),
        'analysisStatus': read(ROOT / active / 'analysis-status.json'),
        'runs': runs,
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            self.send_error(401)
            return
        if self.path != '/snapshot':
            self.send_error(404)
            return
        payload = json.dumps(snapshot(), allow_nan=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 9101), Handler).serve_forever()
