const Notification = require('../modals/notification');
const { getIO } = require('../socket/io');
const { pubClient } = require('../config/redis');

const ACK_TIMEOUT_MS = 5000; // 5s to receive ACK from client

/**
 * Deliver a notification to the recipient across all server instances.
 *
 * Presence check  → Redis SCARD (works on every instance)
 * Emit            → io.to(userId) via Redis adapter (fans out to all instances)
 * ACK collection  → emitWithAck aggregates responses from every socket in the room
 */
async function deliverNotification(notification) {
  const recipientId = notification.recipientId.toString();

  // Fast presence check via Redis — avoids a wasted emit when user is offline
  const socketCount = await pubClient.sCard(`user:${recipientId}:sockets`);
  if (socketCount === 0) {
    return;
  }

  const io = getIO();
  const payload = {
    id: notification._id,
    type: notification.type,
    data: notification.data,
    createdAt: notification.createdAt
  };

  // io.timeout().to(room).emitWithAck() broadcasts across all instances via
  // the Redis adapter and collects ACK callbacks into a single Promise.
  // - Resolves with array of responses (one per socket that ACK'd in time)
  // - Rejects on timeout; err.responses holds any partial ACKs that arrived
  let responses = [];
  try {
    responses = await io.timeout(ACK_TIMEOUT_MS).to(recipientId).emitWithAck('notification', payload);
  } catch (err) {
    // Timeout — capture any partial ACKs that arrived before the deadline
    responses = err.responses || [];
    if (responses.length === 0) {
      console.warn(`⚠️  No ACK for notification ${notification._id}: ${err.message}`);
    }
  }

  // Any response (even ack() with no args → undefined) counts as delivery
  const delivered = responses.length > 0;

  if (delivered) {
    await Notification.findByIdAndUpdate(notification._id, {
      status: 'delivered',
      deliveredAt: new Date(),
      $inc: { deliveryAttempts: 1 },
      lastAttemptAt: new Date()
    });
    console.log(`✅ Delivered notification ${notification._id} | ACKs: ${responses.length}`);
  } else {
    // No ACK — increment attempts, status stays 'created' for retry worker
    await Notification.findByIdAndUpdate(notification._id, {
      $inc: { deliveryAttempts: 1 },
      lastAttemptAt: new Date()
    });
    console.log(`⚠️  No ACK for notification ${notification._id} — will retry (attempt ${(notification.deliveryAttempts || 0) + 1})`);
  }
}

module.exports = { deliverNotification };