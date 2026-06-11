const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    actorId:{
        type: mongoose.Schema.Types.ObjectId,  
        ref: 'User',
        required: true
    },
    type:{
        type: String,
        enum: ['like', 'comment', 'follow'],
        required: true
    },
    entityId:{
        type: mongoose.Schema.Types.ObjectId,
        required: false
    },
    data:{
        type:Object,
        default:{}
    },
    status:{
        type: String,
        enum: ['created', 'delivered', 'read'],
        default: 'created',
        index: true
    },
    deliveredAt:{
        type: Date
    },
    readAt:{
        type: Date
    },
    deliveryAttempts:{
        type: Number,
        default: 0
    },
    lastAttemptAt:{
        type: Date
    }
},{
    timestamps: true
})

notificationSchema.index({recipientId: 1, status: 1, createdAt: -1});
const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;