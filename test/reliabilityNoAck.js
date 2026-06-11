/**
 * Reliability Test — Phase 1 / 2 client
 * Connects as the recipient but NEVER calls ack().
 * Proves that un-acked notifications stay `created` and are retried.
 *
 * Usage:
 *   node test/reliabilityNoAck.js <recipientToken>
 */
const { io } = require('socket.io-client');

const token = process.argv[2];
if (!token) {
  console.error('Usage: node test/reliabilityNoAck.js <recipientToken>');
  process.exit(1);
}

let received = 0;

const socket = io('http://localhost:3000', {
  auth: { token },
  reconnection: false
});

socket.on('connect', () => {
  console.log(`[NoAck] Connected as recipient | socket: ${socket.id}`);
  console.log('[NoAck] Listening for notifications — ACK intentionally suppressed');

  // Keep presence alive with heartbeat every 20s
  setInterval(() => { socket.emit('heartbeat'); }, 20000);
});

socket.on('notification', (payload, ack) => {
  received++;
  console.log(`[NoAck] Received notification #${received} | id: ${payload?.id} | type: ${payload?.type} — NOT acking`);
  // Intentionally do NOT call ack()
});

socket.on('connect_error', (err) => {
  console.error('[NoAck] Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log(`[NoAck] Disconnected: ${reason} | Total received (no ACK): ${received}`);
});

process.on('SIGINT', () => {
  console.log(`\n[NoAck] Shutting down | Total notifications received but NOT acked: ${received}`);
  socket.disconnect();
  process.exit(0);
});
