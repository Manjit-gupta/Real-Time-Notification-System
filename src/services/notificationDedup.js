const Notification = require('../modals/notification');


async function isDuplicateNotification({ recipientId, actorId, type, entityId, windowSeconds = 30 }) {
    const since = new Date(Date.now() - windowSeconds * 1000);

    const existing = await Notification.findOne({
        recipientId,
        actorId,
        type,
        entityId: entityId || null,
        createdAt: { $gte: since }
    }).lean();
    return Boolean(existing);
}

module.exports = { isDuplicateNotification };