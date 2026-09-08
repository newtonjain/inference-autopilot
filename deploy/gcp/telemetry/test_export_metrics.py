import copy
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from export_metrics import ExportError, export, scalar, push_snapshot, NoRedirect

CONFIG = {'projectId': 'example-project', 'location': 'us-central1', 'cluster': 'prod',
          'namespace': 'inference', 'models': {'qwen': 'Qwen/exact-served-name'}}


def sample(value):
    return {'status': 'success', 'data': {'resultType': 'vector', 'result': [
        {'metric': {}, 'value': [1788883200, str(value)]}]}}


class ExportTests(unittest.TestCase):
    def test_fixed_targets_and_explicit_scope(self):
        calls = []
        def request(url, headers):
            calls.append((url, headers))
            if len(calls) == 1:
                self.assertEqual(urlparse(url).hostname, 'metadata.google.internal')
                self.assertEqual(headers, {'Metadata-Flavor': 'Google'})
                return {'access_token': 'test-only-token'}
            self.assertEqual(urlparse(url).hostname, 'monitoring.googleapis.com')
            query = parse_qs(urlparse(url).query)['query'][0]
            for selector in ['namespace="inference"', 'cluster="prod"',
                             'model_name="Qwen/exact-served-name"', 'project_id="example-project"']:
                self.assertIn(selector, query)
            return sample(0.5)
        result = export(CONFIG, request=request, now=datetime(2026, 9, 8, tzinfo=timezone.utc))
        self.assertEqual(len(calls), 8)
        self.assertEqual(result['models'][0]['model'], 'qwen')
        self.assertEqual(result['startTime'], '2026-09-07T23:55:00Z')
        self.assertNotIn('test-only-token', json.dumps(result))
        self.assertNotIn('example-project', json.dumps(result))

    def test_missing_counters_remain_unknown(self):
        def request(url, headers):
            if 'metadata.google.internal' in url:
                return {'access_token': 'test-only-token'}
            return {'status': 'success', 'data': {'resultType': 'vector', 'result': []}}
        row = export(CONFIG, request=request)['models'][0]
        self.assertTrue(all(v is None for k, v in row.items() if k != 'model'))
        for value in ['NaN', '+Inf', '-Inf', '-1']:
            self.assertIsNone(scalar(sample(value)))

    def test_invalid_targets_and_mapping_fail_before_network(self):
        configs = []
        for field, value in [('projectId', '../escape'), ('namespace', '.*'), ('cluster', 'x"} or up')]:
            config = copy.deepcopy(CONFIG)
            config[field] = value
            configs.append(config)
        duplicate = copy.deepcopy(CONFIG)
        duplicate['models']['kimi'] = duplicate['models']['qwen']
        configs.append(duplicate)
        unknown = copy.deepcopy(CONFIG)
        unknown['models'] = {'unknown': 'any'}
        configs.append(unknown)
        arbitrary = copy.deepcopy(CONFIG)
        arbitrary['url'] = 'https://untrusted.example'
        configs.append(arbitrary)
        for config in configs:
            with self.assertRaises(ExportError):
                export(config, request=lambda *_: self.fail('Network must not be called'))

    def test_partial_and_ambiguous_data_rejected(self):
        warning = sample(1)
        warning['warnings'] = ['partial data']
        multiple = sample(1)
        multiple['data']['result'].append(multiple['data']['result'][0])
        labelled = sample(1)
        labelled['data']['result'][0]['metric'] = {'model_name': 'wrong'}
        for result in [warning, multiple, labelled, {'status': 'error'}]:
            with self.assertRaises(ExportError):
                scalar(result)

    def test_invalid_cache_ratio_unknown_and_no_nan_export(self):
        def request(url, headers):
            if 'metadata.google.internal' in url:
                return {'access_token': 'test-only-token'}
            return sample(5)
        result = export(CONFIG, request=request)
        self.assertIsNone(result['models'][0]['prefixHitRate'])
        json.dumps(result, allow_nan=False)

    def test_ingest_rejects_invalid_target_without_network(self):
        for url in ['http://example.com/api/telemetry/ingest',
                    'https://user:password@example.com/api/telemetry/ingest',
                    'https://example.com/wrong',
                    'https://example.com/api/telemetry/ingest?token=private']:
            with self.assertRaises(ExportError):
                push_snapshot({}, url, 'test-only-token')
        with self.assertRaises(ExportError):
            push_snapshot({}, 'https://example.com/api/telemetry/ingest', '')

    def test_ingest_posts_aggregate_and_refuses_redirects(self):
        with patch('urllib.request.build_opener') as build:
            response = build.return_value.open.return_value.__enter__.return_value
            response.status = 202
            push_snapshot({'models': []}, 'https://example.com/api/telemetry/ingest', 'test-only-token')
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.method, 'POST')
            self.assertEqual(json.loads(request.data), {'models': []})
            self.assertEqual(request.get_header('Authorization'), 'Bearer test-only-token')
        with self.assertRaises(ExportError):
            NoRedirect().redirect_request(None, None, 302, None, None, 'https://other.example')


if __name__ == '__main__':
    unittest.main()
