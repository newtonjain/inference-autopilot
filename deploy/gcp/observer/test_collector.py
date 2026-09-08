import unittest
from collector import sanitize_pod


class InventoryContract(unittest.TestCase):
    def test_strips_potentially_sensitive_fields(self):
        pod = {'metadata': {'name': 'qwen-0', 'namespace': 'inference',
                            'labels': {'autopilot/model': 'qwen', 'customer': 'private'},
                            'annotations': {'secret': 'never-export'}},
               'spec': {'nodeName': 'worker-1', 'containers': [
                   {'env': [{'name': 'API_KEY', 'value': 'never-export'}],
                    'args': ['private-prompt'], 'resources': {'limits': {
                        'nvidia.com/gpu': '4', 'memory': '100Gi'}}}]},
               'status': {'phase': 'Running', 'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        result = sanitize_pod(pod)
        self.assertEqual(result['labels'], {'autopilot/model': 'qwen'})
        self.assertEqual(result['accelerators'], [{'nvidia.com/gpu': '4'}])
        self.assertTrue(result['ready'])
        self.assertNotIn('never-export', str(result))
        self.assertNotIn('private-prompt', str(result))

    def test_pending_pod_and_tpu(self):
        result = sanitize_pod({'spec': {'containers': [{'resources': {'limits': {'google.com/tpu': 4}}}]}})
        self.assertFalse(result['ready'])
        self.assertIsNone(result['node'])
        self.assertEqual(result['accelerators'], [{'google.com/tpu': 4}])


if __name__ == '__main__':
    unittest.main()
