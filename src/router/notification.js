const express = require('express');
const notificationRouter = express.Router();
const mongoose = require('mongoose');

const Notification = require('../modals/notification');
const auth = require('../middlewares/auth');

const allowedStatuses = ['created', 'delivered', 'read'];

notificationRouter.get('/', auth, async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 500);
    const skip = (page - 1) * limit;

    const status = req.query.status;
    const filter = {
      recipientId: req.user._id
    };

    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      filter.status = status;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter)
    ]);

    res.json({
      page,
      limit,
      total,
      count: notifications.length,
      notifications
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});


notificationRouter.patch('/:id/read', auth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }

    const result = await Notification.updateOne(
      { _id: req.params.id, recipientId: req.user._id, status: { $ne: 'read' } },
      { status: 'read', readAt: new Date() }
    );

    if (result.matchedCount === 0) {
      const exists = await Notification.exists({ _id: req.params.id, recipientId: req.user._id });
      if (!exists) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      return res.status(200).json({ message: 'Already read' });
    }

    res.json({ message: 'Marked as read' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});


notificationRouter.patch('/read-all', auth, async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { recipientId: req.user._id, status: { $ne: 'read' } },
      { status: 'read', readAt: new Date() }
    );

    res.json({
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

module.exports = notificationRouter;
