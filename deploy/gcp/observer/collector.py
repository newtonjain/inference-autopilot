"""Read-only, namespaced Kubernetes inventory. No prompts, secrets, env, or logs exported."""
import json
import os
import ssl
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN_ROOT = Path('/var/run/secrets/kubernetes.io/serviceaccount')
STATE = {'schemaVersion': 1, 'kind': 'inference-autopilot.gke-snapshot',
         'source': 'gke-observer', 'ready': False, 'mode': 'observe-only',
         'pods': [], 'errors': []}
LOCK = threading.Lock()
ALLOWED_LABELS = ('app.kubernetes.io/name', 'autopilot/model', 'autopilot/replica',
                  'autopilot/role', 'autopilot/tp', 'autopilot/pp', 'autopilot/ep',
                  'autopilot/dp', 'autopilot/hardware', 'autopilot/group')


def sanitize_pod(pod):
    metadata, spec, status = (pod.get(k, {}) for k in ('metadata', 'spec', 'status'))
    return {'name': metadata.get('name'), 'namespace': metadata.get('namespace'),
            'labels': {k: v for k, v in metadata.get('labels', {}).items() if k in ALLOWED_LABELS},
            'node': spec.get('nodeName'), 'phase': status.get('phase'),
            'ready': any(c.get('type') == 'Ready' and c.get('status') == 'True'
                         for c in status.get('conditions', [])),
            'accelerators': [{k: v for k, v in c.get('resources', {}).get('limits', {}).items()
                              if k in ('nvidia.com/gpu', 'google.com/tpu')}
                             for c in spec.get('containers', [])]}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Kubernetes API redirects are not allowed')


def collect():
    namespace = os.environ['WATCH_NAMESPACE']
    # Namespace is operator-controlled, never an HTTP query parameter.
    namespace = urllib.parse.quote(namespace, safe='')
    context = ssl.create_default_context(cafile=str(TOKEN_ROOT / 'ca.crt'))
    request = urllib.request.Request(
        'https://kubernetes.default.svc/api/v1/namespaces/' + namespace + '/pods',
        headers={'Authorization': 'Bearer ' + (TOKEN_ROOT / 'token').read_text().strip()})
    # Explicit API host only, no discovery of arbitrary pod metrics URLs.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                        urllib.request.HTTPSHandler(context=context), NoRedirect())
    with opener.open(request, timeout=10) as response:
        data = json.loads(response.read(8 * 1024 * 1024))
    if data.get('metadata', {}).get('continue'):
        raise ValueError('Inventory requires pagination; refusing incomplete snapshot')
    return [sanitize_pod(p) for p in data.get('items', [])]


def poll():
    while True:
        try:
            pods = collect()
            with LOCK:
                STATE.update(ready=True, pods=pods, observedAt=time.time(), errors=[])
        except Exception as error:
            # Do not echo request URLs, tokens, response bodies or exception messages.
            with LOCK:
                STATE.update(ready=False, errors=[type(error).__name__])
        time.sleep(15)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with LOCK:
            snapshot = dict(STATE)
        if self.path == '/healthz':
            payload, code = {'alive': True}, 200
        elif self.path == '/readyz':
            payload, code = {'ready': snapshot['ready']}, 200 if snapshot['ready'] else 503
        elif self.path == '/snapshot':
            payload, code = snapshot, 200 if snapshot['ready'] else 503
        else:
            payload, code = {'error': 'not found'}, 404
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    threading.Thread(target=poll, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
