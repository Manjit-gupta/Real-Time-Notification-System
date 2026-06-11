const Notification = require('../modals/notification');
const { deliverNotification } = require('./notificationDelivery');
const { pubClient } = require('../config/redis');

// In test env use short intervals so reliability test completes quickly
const IS_TEST           = process.env.NODE_ENV === 'test';
const RETRY_INTERVAL_MS = IS_TEST ? 5  * 1000 : 30 * 1000;  // 5s (test) / 30s (prod)
const RETRY_COOLDOWN_MS = IS_TEST ? 5  * 1000 : 60 * 1000;  // 5s (test) / 60s (prod)
const MAX_ATTEMPTS      = 5;          // give up after 5 failed attempts

function startRetryWorker() {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MS);

      // Fetch all pending notifications regardless of instance — Redis presence
      // check below is the authoritative online filter (works across instances)
      const pending = await Notification.find({
        status: 'created',
        deliveryAttempts: { $lt: MAX_ATTEMPTS },
        $or: [
          { lastAttemptAt: { $exists: false } },
          { lastAttemptAt: { $lte: cutoff } }
        ]
      }).limit(100);

      if (pending.length === 0) return;

      // Filter to recipients who are currently online according to Redis presence
      const onlineNotifications = [];
      for (const notification of pending) {
        const userId = notification.recipientId.toString();
        const socketCount = await pubClient.sCard(`user:${userId}:sockets`);
        if (socketCount > 0) {
          onlineNotifications.push(notification);
        }
      }

      if (onlineNotifications.length === 0) return;

      console.log(`🔄 Retry worker: attempting ${onlineNotifications.length} notification(s) (interval=${RETRY_INTERVAL_MS/1000}s, cooldown=${RETRY_COOLDOWN_MS/1000}s)`);

      for (const notification of onlineNotifications) {
        await deliverNotification(notification);
      }
    } catch (err) {
      console.error('Retry worker error:', err);
    }
  }, RETRY_INTERVAL_MS);

  console.log('🔄 Notification retry worker started');
}

module.exports = { startRetryWorker };
