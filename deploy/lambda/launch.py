#!/usr/bin/env python3
"""Launch the declared configuration, verify health, then collect live evidence."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request


def command(config):
    return [
        'docker', 'run', '--detach', '--name', 'autopilot-gemma',
        '--restart', 'unless-stopped', '--gpus', 'device=0', '--ipc=host',
        '-p', '127.0.0.1:8000:8000',
        '-v', str(Path.home() / '.cache/huggingface') + ':/root/.cache/huggingface',
        '-e', 'HF_TOKEN', config['image'],
        '--model', config['checkpoint'], '--revision', config['revision'],
        '--served-model-name', config['model'], '--dtype', config['activationDtype'],
        '--tensor-parallel-size', str(config['tensorParallelSize']),
        '--max-model-len', str(config['maxModelLen']),
        '--max-num-seqs', str(config['maxNumSeqs']),
        '--max-num-batched-tokens', str(config['maxNumBatchedTokens']),
        '--gpu-memory-utilization', str(config['gpuMemoryUtilization']),
        '--enable-prefix-caching' if config['prefixCaching'] else '--no-enable-prefix-caching',
        '--host', '0.0.0.0', '--port', '8000',
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('serving.json'))
    parser.add_argument('--output', type=Path, default=Path('evidence/baseline'))
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    cmd = command(config)
    if args.dry_run:
        print(json.dumps(cmd, indent=2))
        return
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'configuration.json').write_text(json.dumps(config, indent=2) + '\n')
    subprocess.run(['nvidia-smi'], check=True)
    subprocess.run(cmd, check=True)
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        state = subprocess.check_output(
            ['docker', 'inspect', '--format', '{{.State.Status}}', 'autopilot-gemma'], text=True).strip()
        if state in ('exited', 'dead', 'restarting'):
            raise RuntimeError('Model container failed; inspect docker logs autopilot-gemma')
        try:
            with urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5) as response:
                if response.status == 200:
                    print('Gemma is healthy; starting live telemetry.', flush=True)
                    os.execv(sys.executable, [sys.executable, 'live_agent.py', '--config',
                                             str(args.config), '--output', str(args.output)])
        except (OSError, TimeoutError):
            pass
        print('Waiting for model download/loading; inspect docker logs autopilot-gemma for progress.', flush=True)
        time.sleep(10)
    raise TimeoutError('Model was not healthy within 30 minutes; container retained for inspection')


if __name__ == '__main__':
    main()
