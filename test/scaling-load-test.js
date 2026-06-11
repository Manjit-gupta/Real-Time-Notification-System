/**
 * Test 3 — Horizontal Scaling Load Test
 *
 * Receives TOKEN and RECIPIENT_ID from environment so the PS1 orchestrator
 * can inject fresh credentials per run without editing this file.
 *
 * Usage (manual):
 *   k6 run -e TOKEN=<jwt> -e RECIPIENT_ID=<id> test/scaling-load-test.js
 *
 * Profile: ramp to 200 VUs over 20s, hold 40s, ramp down 20s  (same as Test 1)
 */
import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
  stages: [
    { duration: '20s', target: 100 },
    { duration: '40s', target: 200 },
    { duration: '20s', target: 0  }
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // relaxed — we compare relative numbers, not absolute
    http_req_failed:   ['rate<0.01']
  }
};

const TOKEN        = __ENV.TOKEN        || '';
const RECIPIENT_ID = __ENV.RECIPIENT_ID || '';
const BASE_URL     = __ENV.BASE_URL     || 'http://localhost:3000';

export default function () {
  http.post(
    `${BASE_URL}/users/${RECIPIENT_ID}/follow`,
    null,
    { headers: { Cookie: `token=${TOKEN}` } }
  );
  // No sleep — maximum throughput pressure
}
