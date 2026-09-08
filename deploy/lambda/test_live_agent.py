import unittest
from live_agent import parse_metrics, summarize


class MetricsTests(unittest.TestCase):
    def test_reset_in_one_worker_is_not_hidden_by_another(self):
        previous = parse_metrics('vllm:request_success_total{worker="0"} 100\nvllm:request_success_total{worker="1"} 100')
        current = parse_metrics('vllm:request_success_total{worker="0"} 1\nvllm:request_success_total{worker="1"} 300')
        self.assertIsNone(summarize(previous, current, 10)['completedRps'])

    def test_means_from_histogram_deltas_and_missing_values(self):
        previous = parse_metrics('vllm:time_to_first_token_seconds_sum 10\nvllm:time_to_first_token_seconds_count 5')
        current = parse_metrics('vllm:time_to_first_token_seconds_sum 14\nvllm:time_to_first_token_seconds_count 7')
        result = summarize(previous, current, 10)
        self.assertEqual(result['meanTtftSeconds'], 2)
        self.assertIsNone(result['completedRps'])
        self.assertIsNone(result['waiting'])

    def test_series_disappearance_invalidates_rate(self):
        previous = parse_metrics('vllm:request_success_total{worker="0"} 10\nvllm:request_success_total{worker="1"} 10')
        current = parse_metrics('vllm:request_success_total{worker="0"} 20')
        self.assertIsNone(summarize(previous, current, 10)['completedRps'])


if __name__ == '__main__':
    unittest.main()
