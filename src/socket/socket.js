// onlineUsers in-memory Map removed.
// Presence is now tracked in Redis: user:{userId}:sockets (Set with 60s TTL)
// See src/config/redis.js and the connection handler in src/app.js
