const { createClient } = require("redis");

const pubClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

const subClient = pubClient.duplicate();

pubClient.on("error", (err) => console.error("Redis pubClient error:", err));
subClient.on("error", (err) => console.error("Redis subClient error:", err));

async function connectRedis() {
  await pubClient.connect();
  await subClient.connect();
  console.log("✅ Redis connected");
}

module.exports = {
  pubClient,
  subClient,
  connectRedis
};
