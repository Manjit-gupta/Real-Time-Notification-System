const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { pubClient, subClient, connectRedis } = require('./config/redis');
const { setIO } = require('./socket/io');
const { deliverNotification } = require("./services/notificationDelivery");
const { startRetryWorker } = require('./services/retryWorker');
const Notification = require('./modals/notification');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
setIO(io);

const socketAuth = require('./middlewares/socketAuth');
io.use(socketAuth);

app.use(express.json());
app.use(cookieParser());

const port = process.env.PORT || 3000;

const authRouter = require('./router/auth');
const notificationRouter = require('./router/notification');
const actionRouter = require('./router/action');

app.use('/', authRouter);
app.use('/notifications', notificationRouter);
app.use('/', actionRouter);


io.on("connection", (socket) => {
  const userId = socket.userId;
  if (!userId) {
    console.log('User ID not found on socket');
    socket.disconnect();
    return;
  }

  // Join distributed room — Redis adapter propagates this across all instances
  socket.join(userId);

  ;(async () => {
    try {
      // Register this socket in Redis presence set with a 60s TTL
      await pubClient.sAdd(`user:${userId}:sockets`, socket.id);
      await pubClient.expire(`user:${userId}:sockets`, 60);

      const socketCount = await pubClient.sCard(`user:${userId}:sockets`);
      console.log(`✅ User ${userId} ONLINE | Active sockets: ${socketCount}`);

      // Replay all undelivered notifications on connect / reconnect
      const pendingNotifications = await Notification.find({
        recipientId: userId,
        status: 'created'
      }).sort({ createdAt: 1 });

      for (const notification of pendingNotifications) {
        await deliverNotification(notification);
      }
    } catch (err) {
      console.error('Connection setup error:', err);
    }
  })();

  // Client sends heartbeat every 30s to keep presence lease alive (TTL = 60s)
  socket.on("heartbeat", async () => {
    try {
      await pubClient.expire(`user:${userId}:sockets`, 60);
    } catch (err) {
      console.error('Heartbeat error:', err);
    }
  });

  socket.on("disconnect", async () => {
    try {
      await pubClient.sRem(`user:${userId}:sockets`, socket.id);
      const remaining = await pubClient.sCard(`user:${userId}:sockets`);
      if (remaining === 0) {
        await pubClient.del(`user:${userId}:sockets`);
        console.log(`🔴 User ${userId} OFFLINE`);
      } else {
        console.log(`🟡 User ${userId} still online | Remaining sockets: ${remaining}`);
      }
    } catch (err) {
      console.error('Disconnect cleanup error:', err);
    }
  });
});

app.use((err, req, res, next) => {
  res.status(err.statusCode || 400).json({
    error: err.message || 'Something went wrong'
  });
});

async function bootstrap() {
  try {
    await connectDB();
    await connectRedis();
    // Attach Redis adapter — Socket.IO now routes emits across all instances
    io.adapter(createAdapter(pubClient, subClient));
    startRetryWorker();
    server.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  }
}

bootstrap();
