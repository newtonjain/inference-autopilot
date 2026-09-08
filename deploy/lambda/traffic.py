#!/usr/bin/env python3
"""Bounded synthetic prompts sent to real local Gemma inference."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import statistics
import time
import urllib.request


def request(index):
    prefix = ('Our inference service handles requests with a queue, a GPU worker, and a cache. '
              'We measure completion rate and latency and compare serving configurations. ') * 60
    payload = {'model': 'google/gemma-4-26B-A4B-it',
               'messages': [{'role': 'user', 'content': prefix + f' Explain one useful performance measurement. Example {index}.'}],
               'max_tokens': 128, 'temperature': 0, 'stream': False,
               'chat_template_kwargs': {'enable_thinking': False}}
    started = time.monotonic()
    try:
        req = urllib.request.Request('http://127.0.0.1:8000/v1/chat/completions',
              data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=180) as response:
            result = json.load(response)
        return {'request': index, 'success': True, 'latencySeconds': time.monotonic() - started,
                'tokens': result.get('usage'), 'source': 'measured endpoint'}
    except Exception as error:
        return {'request': index, 'success': False, 'latencySeconds': time.monotonic() - started,
                'error': type(error).__name__}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--requests', type=int, default=60)
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--output', type=Path, help='Save measured requests and aggregate results as JSON')
    parser.add_argument('--label', default='baseline', help='Serving configuration label for this run')
    args = parser.parse_args()
    if not 1 <= args.requests <= 1000 or not 1 <= args.concurrency <= 32:
        parser.error('Use 1–1000 requests and 1–32 concurrent requests')
    started = time.monotonic()
    results = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for result in pool.map(request, range(args.requests)):
            results.append(result)
            print(json.dumps(result), flush=True)
    elapsed = time.monotonic() - started
    successful = [r for r in results if r['success']]
    latencies = sorted(r['latencySeconds'] for r in successful)
    summary = {
        'label': args.label, 'source': 'measured endpoint; synthetic repeated-prefix traffic',
        'requests': args.requests, 'concurrency': args.concurrency,
        'successful': len(successful), 'failed': len(results) - len(successful),
        'elapsedSeconds': elapsed, 'completedRequestsPerSecond': len(successful) / elapsed,
        'meanLatencySeconds': statistics.mean(latencies) if latencies else None,
        'p95LatencySeconds': latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None,
    }
    print(json.dumps({'summary': summary}), flush=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({'summary': summary, 'results': results}, indent=2) + '\n')
