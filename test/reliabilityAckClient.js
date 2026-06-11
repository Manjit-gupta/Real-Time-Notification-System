/**
 * Reliability Test — Phase 3 client
 * Connects as the recipient and ALWAYS calls ack().
 * On connect the server immediately replays all `created` notifications
 * and this client ACKs them — proving at-least-once delivery.
 *
 * Usage:
 *   node test/reliabilityAckClient.js <recipientToken>
 */
const { io } = require('socket.io-client');

const token = process.argv[2];
if (!token) {
  console.error('Usage: node test/reliabilityAckClient.js <recipientToken>');
  process.exit(1);
}

let received  = 0;
let acked     = 0;
const received_ids = new Set();

const socket = io('http://localhost:3000', {
  auth: { token },
  reconnection: false
});

socket.on('connect', () => {
  console.log(`[AckClient] Connected as recipient | socket: ${socket.id}`);
  console.log('[AckClient] Server will replay all pending notifications now…');

  // Keep presence alive
  setInterval(() => { socket.emit('heartbeat'); }, 20000);
});

socket.on('notification', (payload, ack) => {
  received++;
  const isNew = !received_ids.has(payload?.id?.toString());
  received_ids.add(payload?.id?.toString());

  if (typeof ack === 'function') {
    ack();
    acked++;
    console.log(`[AckClient] ACK'd notification #${received} | id: ${payload?.id} | type: ${payload?.type} | new: ${isNew}`);
  } else {
    console.warn(`[AckClient] No ack callback on notification #${received} | id: ${payload?.id}`);
  }
});

socket.on('connect_error', (err) => {
  console.error('[AckClient] Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log(`[AckClient] Disconnected: ${reason}`);
  console.log(`[AckClient] Summary — received: ${received} | acked: ${acked}`);
});

// Auto-exit after 60 seconds so test can proceed
setTimeout(() => {
  console.log(`\n[AckClient] 60s window complete`);
  console.log(`[AckClient] FINAL — received: ${received} | acked: ${acked}`);
  socket.disconnect();
  process.exit(0);
}, 60000);

process.on('SIGINT', () => {
  console.log(`\n[AckClient] FINAL — received: ${received} | acked: ${acked}`);
  socket.disconnect();
  process.exit(0);
});
