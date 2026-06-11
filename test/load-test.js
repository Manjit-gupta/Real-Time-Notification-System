import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
  stages: [
    { duration: '20s', target: 100 },
    { duration: '40s', target: 200 },
    { duration: '20s', target: 0 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed:   ['rate<0.01']
  }
};

const TOKEN        = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWE0NDJjYzRmZWZiNzRhNDhhZTY1NDYiLCJpYXQiOjE3NzIzNzQyMDcsImV4cCI6MTc3MjM3NzgwN30.SpU4nYvqLZcuBac7F9Z6pTCPVJSS9tAkRZUjKyOM_uM';
const RECIPIENT_ID = '69a442d34fefb74a48ae654a';

export default function () {
  http.post(
    `http://localhost:3000/users/${RECIPIENT_ID}/follow`,
    null,
    { headers: { Cookie: `token=${TOKEN}` } }
  );
}
