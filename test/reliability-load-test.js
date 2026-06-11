/**
 * k6 load script for Reliability Test
 * Smaller load than the performance test — goal is to generate a known
 * batch of notifications, not to measure throughput.
 *
 * Profile: ramp to 50 VUs over 10s, hold 30s, ramp down 10s
 * Expected: ~1000–1500 notifications created
 */
import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0  }
  ],
  // No latency threshold — this test is about delivery correctness, not speed
  thresholds: {
    http_req_failed: ['rate<0.01']
  }
};

const TOKEN        = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWE0NGI5ZTczZGViMGFjY2FjNjQ4MzMiLCJpYXQiOjE3NzIzNzUwODgsImV4cCI6MTc3MjM3ODY4OH0.9MbquzAUGZCfV3T-Af7_lWKnJxnKCIjdle8z2hmcz9I';
const RECIPIENT_ID = '69a44bae73deb0accac64839';

export default function () {
  http.post(
    `http://localhost:3000/users/${RECIPIENT_ID}/follow`,
    null,
    { headers: { Cookie: `token=${TOKEN}` } }
  );
  sleep(0.1);
}
