const express = require('express');
const actionRouter = express.Router();
const mongoose = require('mongoose');

const Notification = require('../modals/notification');
const User = require('../modals/user');
const auth = require('../middlewares/auth');
const { deliverNotification } = require('../services/notificationDelivery');
const { isDuplicateNotification } = require('../services/notificationDedup');
const rateLimit = require("express-rate-limit");

const actionLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()   // disabled during load tests
  : rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 1500,
      message: 'Too many actions from this IP, please try again after a minute'
    });


async function createNotification({ recipientId, actorId, type, entityId, data, status = 'created' }) {
  return Notification.create({
    recipientId,
    actorId,
    type,
    entityId,
    data,
    status
  });
}



actionRouter.post('/users/:id/follow', auth, actionLimiter, async (req, res) => {
  try {
    const recipientId = req.params.id;
    const actorId = req.user._id;

    if (!mongoose.isValidObjectId(recipientId)) {
      throw new Error('Invalid user id');
    }

    if (actorId.equals(recipientId)) {
      throw new Error('Users cannot follow themselves');
    }

    const targetUser = await User.findById(recipientId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    const isDuplicate = await isDuplicateNotification({
      recipientId: targetUser._id,
      actorId,
      type: "follow",
      entityId: null
    });

    if (isDuplicate) {
      return res.status(200).json({ message: "Already notified recently" });
    }


    const notification = await createNotification({
      recipientId: targetUser._id,
      actorId: actorId,
      type: 'follow',
      entityId: null,
      data: {
        message: `${req.user.email} started following you.`
      },
      status: 'created'
    });
    await deliverNotification(notification);

    res.status(201).json({ message: 'Follow action recorded' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});


actionRouter.post('/users/:id/like', auth, actionLimiter, async (req, res) => {
  try {
    const recipientId = req.params.id;
    const actorId = req.user._id;

    if (!mongoose.isValidObjectId(recipientId)) {
      throw new Error('Invalid user id');
    }
    if (actorId.equals(recipientId)) {
      throw new Error('You cannot like yourself');
    }

    const targetUser = await User.findById(recipientId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    const isDuplicate = await isDuplicateNotification({
      recipientId: targetUser._id,
      actorId,
      type: "like",
      entityId: null
    });

    if (isDuplicate) {
      return res.status(200).json({ message: "Already notified recently" });
    }


    const notification = await createNotification({
      recipientId: targetUser._id,
      actorId: actorId,
      type: 'like',
      entityId: null,
      data: {
        message: `${req.user.email} liked your post.`
      },
      status: 'created'
    });

    await deliverNotification(notification);
    res.status(201).json({ message: 'Like action recorded' });



  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
})

module.exports = actionRouter;
