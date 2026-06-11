<div align="center">

# Real-Time Notification System

**Distributed Node.js backend — real-time WebSocket delivery, ACK-based reliability, Redis presence, offline replay, deduplication.**

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-FF4438?style=for-the-badge&logo=redis&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

</div>

---

## Contents

- [TL;DR](#tldr)
- [Why This Project](#why-this-project)
- [Key Highlights](#key-highlights)
- [Features](#features)
- [Architecture](#architecture)
- [Performance Benchmarks](#performance-benchmarks)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Running Locally](#running-locally)
- [Design Decisions](#design-decisions)
- [Trade-offs](#trade-offs)
- [Future Work](#future-work)

---

## TL;DR

- Distributed real-time notification system using Node.js, Redis, MongoDB, Socket.IO
- Guarantees **at-least-once delivery** using ACK + retry worker
- Supports **offline replay**, **deduplication**, and **distributed presence**
- Horizontally scalable via `@socket.io/redis-adapter`
- Tested with k6: ~360 req/s (single instance), **0% error rate**
- Proven **100% eventual delivery with zero data loss**

> Built to simulate production-grade notification system design challenges.

---

## Why This Project

Most notification systems are fire-and-forget. This breaks in distributed systems:

- Notifications are lost when users are offline
- Multi-instance deployments fail due to local memory state
- No delivery guarantees or retry mechanisms

This project solves all three:

| Problem | Solution |
|---|---|
| Data loss on crash | MongoDB write before any socket work |
| Split-brain across instances | Redis presence Sets + Redis adapter |
| Missed delivery for offline users | ACK timeout + retry worker + reconnect replay |

---

## Key Highlights

- Built a **distributed notification system** with horizontal scaling support
- Implemented **at-least-once delivery guarantees** — proven under test conditions
- Designed **Redis-based presence** — multi-instance safe, crash-safe (TTL-backed)
- Developed **retry worker + reconnect replay** for zero notification loss
- Achieved **0% data loss** and **100% eventual delivery** under failure conditions

---

## Features

| Feature | Description |
|---|---|
| **JWT Auth** | HTTP cookie + Socket.IO handshake authentication |
| **Persistent Notifications** | MongoDB is the source of truth — never lost |
| **Real-Time Delivery** | Instant push via Socket.IO when user is online |
| **Offline Replay** | Pending notifications re-delivered on reconnect |
| **ACK-Based Delivery** | Marked `delivered` only after client confirms receipt |
| **Retry Worker** | Background worker retries failed deliveries every 30s |
| **Deduplication** | 30-second window suppresses duplicate notifications |
| **Redis Presence** | Distributed presence via Redis Sets — multi-instance safe |
| **Horizontal Scaling** | `@socket.io/redis-adapter` routes emits across all instances |
| **Rate Limiting** | Per-IP rate limits on action routes |
| **Paginated Fetch** | Filter and paginate notifications by status |

---

## Architecture

```
+-------------------------------------------------------------+
|                          CLIENT(S)                          |
|    HTTP (REST API)              WebSocket (Socket.IO)       |
+------------------+------------------+----------------------+
                   |                  |
         +---------+------+  +--------+---------+
         | Node.js Inst A |  | Node.js Inst B   |
         | Express        |  | Express          |
         | Socket.IO      |  | Socket.IO        |
         +--------+-------+  +--------+---------+
                  |                   |
                  +--------+----------+
                           |
              +------------+------------+
              |           REDIS          |
              |  Pub/Sub (adapter)       |  <- cross-instance emit routing
              |  Presence Sets           |  <- user:{id}:sockets  TTL 60s
              +------------+------------+
                           |
              +------------+------------+
              |          MONGODB         |
              |  Users + Notifications   |  <- source of truth
              +-------------------------+
```

> **Core principle:** MongoDB write happens **before** any socket emit. Redis is routing + presence. WebSocket delivery is an optimization on top of durable storage.

---

## Performance Benchmarks

All tests run with k6 at 200 VUs. Full results in `test/TESTING.md`.

### HTTP Performance (Single Instance, Rate Limiter Disabled)

| Metric | Value |
|---|---|
| Throughput | 362 req/s |
| Avg latency | 311ms |
| P95 latency | 596ms |
| Error rate | **0%** |

### Reliability (ACK + Retry Test)

| Metric | Value |
|---|---|
| Notification loss | **0%** |
| Eventual delivery | **100%** |
| Avg delivery attempts | 2.0 |
| First-try delivery | 0% (intentionally blocked) |
| Retry / replay delivery | 100% |

### Horizontal Scaling (Docker, 3 instances)

| Instances | Throughput | Error Rate |
|---|---|---|
| 1 | 371 req/s | 0% |
| 2 | 364 req/s | 0% |
| 3 | 369 req/s | 0% |

> Throughput is flat because all instances share one MongoDB container and nginx `ip_hash` routes all k6 VUs (same IP) to one instance. In a real multi-server deployment with separate DB nodes, each instance adds proportional capacity. Zero errors across all runs proves the Redis adapter works correctly.

---

## Core Concepts

### Distributed Presence (Redis)

**Problem:** In-memory state breaks across instances.

```
Instance A  ->  Map { user1: [socket1] }
Instance B  ->  Map { user3: [socket3] }

Notification for user1 arrives at Instance B
-> B checks its own Map -> sees nothing -> skips
-> user1 is online on Instance A, but B has no idea  ❌
```

**Solution:** Redis Sets with TTL as shared presence store.

```
Connect:     SADD  user:{userId}:sockets  <socketId>
             EXPIRE user:{userId}:sockets  60
Heartbeat:   EXPIRE user:{userId}:sockets  60
Disconnect:  SREM  user:{userId}:sockets  <socketId>
Check:       SCARD user:{userId}:sockets  ->  0 = offline, >0 = online
```

Cross-instance delivery uses `@socket.io/redis-adapter`:

```js
io.adapter(createAdapter(pubClient, subClient));
io.to(userId).emitWithAck('notification', payload);
```

The adapter publishes to a Redis channel. Every instance delivers to its local sockets for that user and ACKs aggregate back into one Promise.

The client must send a heartbeat every **30 seconds** to keep the 60s TTL lease alive:

```js
setInterval(() => socket.emit("heartbeat"), 30000);
```

---

### Notification Lifecycle

```
Actor hits action endpoint
        |
        v
  Dedup check  ---duplicate within 30s?---> 200 Already notified
        |
     (new)
        v
  Notification.create()     <- status = "created", persisted immediately
        |
        v
  SCARD user:{id}:sockets
     |          |
    >0          0
     |          |
     v          v
  emitWithAck  stays "created"
  (5s timeout) retried on reconnect / by retry worker
     |
  ACK received?
     |          |
    YES         NO
     |          |
     v          v
status=delivered   deliveryAttempts++
deliveredAt=now    status stays "created"
                   <- retry worker picks it up
        |
        v  (eventually)
  PATCH /:id/read
        |
        v
  status = "read"
```

### Status Reference

| Status | Meaning |
|---|---|
| `created` | Persisted, not yet confirmed delivered |
| `delivered` | At least one socket ACK'd receipt |
| `read` | User explicitly marked as read |

---

### ACK Mechanism

```
Server                               Client
  |                                    |
  |-- io.to(userId).emitWithAck() ---> |
  |   Redis adapter fans out to        |-- processes notification
  |   all instances                    |
  |                                    |
  |<------------ ack() ---------------|
  |   ACKs aggregate via Redis         |
  v
responses.length > 0  ->  status = "delivered"
responses.length = 0  ->  deliveryAttempts++, stays "created"
```

> The client **must** call the ACK callback:
> ```js
> socket.on("notification", (payload, ack) => {
>   console.log(payload);
>   ack(); // required
> });
> ```

---

### Retry Worker

`services/retryWorker.js` polls MongoDB every 30 seconds.

| Config | Value |
|---|---|
| Poll interval | 30s |
| Retry cooldown | 60s between attempts per notification |
| Max attempts | 5 |

```
Retry cycle:
  1. Find: status='created', attempts < 5, lastAttemptAt > 60s ago
  2. For each: SCARD user:{id}:sockets via Redis
  3. socketCount > 0  ->  deliverNotification()
  4. socketCount = 0  ->  skip (user still offline)
```

---

### Reconnect Replay

On every socket connection, the server immediately queries all `status: 'created'` notifications for that user and re-emits them. This covers the fully offline case without waiting for the 30-second retry tick.

> Guaranteed: **zero notification loss** even if the server crashes mid-delivery or the client disconnects without ACKing.

---

## Data Models

### User

| Field | Type | Notes |
|---|---|---|
| `email` | String | required, unique, lowercase |
| `password` | String | bcrypt hash |

### Notification

| Field | Type | Notes |
|---|---|---|
| `recipientId` | ObjectId | indexed |
| `actorId` | ObjectId | who triggered it |
| `type` | String | `like` \| `comment` \| `follow` |
| `entityId` | ObjectId | optional |
| `data` | Object | arbitrary payload |
| `status` | String | `created` → `delivered` → `read` |
| `deliveredAt` | Date | set on ACK |
| `readAt` | Date | set on read |
| `deliveryAttempts` | Number | incremented on every emit |
| `lastAttemptAt` | Date | timestamp of last attempt |

> Compound index: `{ recipientId: 1, status: 1, createdAt: -1 }` — covers dashboard queries and retry worker in one scan.

---

## API Reference

### Auth

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/signup` | No | Register |
| `POST` | `/login` | No | Login — sets `token` cookie |
| `POST` | `/logout` | Yes | Clears cookie |
| `GET` | `/me` | Yes | Current user |

### Actions

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/users/:id/follow` | Yes | Follow a user — creates `follow` notification |
| `POST` | `/users/:id/like` | Yes | Like a post — creates `like` notification |

### Notifications

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/notifications` | Yes | Paginated list |
| `PATCH` | `/notifications/:id/read` | Yes | Mark one as read |
| `PATCH` | `/notifications/read-all` | Yes | Mark all as read |

**Query params for `GET /notifications`:**

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `20` | Per page (max 500) |
| `status` | all | `created` \| `delivered` \| `read` |

---

## Running Locally

**Prerequisites:** Node.js 18+, Docker (recommended) or MongoDB + Redis locally.

### With Docker
```bash
docker compose up
```
Starts MongoDB, Redis, and the app behind nginx on `localhost:4000`.

### Without Docker
```bash
# 1. Install dependencies
npm install

# 2. Create .env
MONGO_URI=mongodb://127.0.0.1:27017/notifications
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=your_secret
PORT=3000

# 3. Start
npm run dev
```

### Test Client

```bash
# 1. Login and copy the token
# 2. Paste it into test/socketClient.js
node test/socketClient.js
```

---

## Folder Structure

```
src/
├── app.js                       # Entry point
├── config/
│   ├── db.js                    # Mongoose connection
│   └── redis.js                 # pubClient + subClient + connectRedis()
├── middlewares/
│   ├── auth.js                  # HTTP JWT guard
│   └── socketAuth.js            # Socket.IO JWT guard
├── modals/
│   ├── user.js
│   └── notification.js
├── router/
│   ├── auth.js                  # /signup /login /logout /me
│   ├── notification.js          # GET + PATCH notifications
│   └── action.js                # /follow /like
├── services/
│   ├── notificationDelivery.js  # Redis presence + emitWithAck
│   ├── notificationDedup.js     # 30-second dedup window
│   └── retryWorker.js           # Background retry (Redis-aware)
├── socket/
│   ├── io.js                    # Global io singleton
│   └── socket.js
└── utils/
    └── validation.js

test/
├── notificationDelivery.test.js  # 5 Jest unit tests (all pass)
├── load-test.js                  # k6 performance test
├── reliability-load-test.js      # k6 reliability test
├── reliabilityNoAck.js           # Socket client — suppresses ACK
├── reliabilityAckClient.js       # Socket client — ACKs all notifications
├── dbStats.js                    # MongoDB delivery stats query
├── scaling-load-test.js          # k6 scaling test
├── run-scaling-test.ps1          # Full 1/2/3 instance orchestration
├── socketClient.js               # Manual test client
└── TESTING.md                    # All test results
```

---

## Design Decisions

| Decision | Rationale |
|---|---|
| **Database write before emit** | Server crashes or socket failures never cause data loss |
| **Redis presence over in-memory Map** | In-memory Maps break across instances. Redis Sets with TTL are globally visible and crash-safe |
| **Redis adapter over manual pub/sub** | `io.to(userId).emit()` works transparently across any number of instances |
| **At-least-once over exactly-once** | Exactly-once requires distributed locking. At-least-once is correct for notifications; rare duplicates are tolerable |
| **Polling retry over message queue** | `setInterval` + MongoDB polling is zero-dependency and correct at this scale. Kafka adds overhead only justified at higher throughput |
| **ACK timeout at 5s** | Long enough for normal network conditions; short enough to detect failures without blocking delivery state |
| **Compound index `{ recipientId, status, createdAt }`** | Covers both dashboard fetch and retry worker in a single index scan |
| **Presence TTL + heartbeat** | 60s TTL / 30s heartbeat: stale entries from crashed servers auto-expire in ≤60s, no cleanup job needed |

---

## Trade-offs

| Trade-off | Mitigation |
|---|---|
| At-least-once can produce rare duplicates during retries | Client deduplicates by `notification.id` |
| Polling retry runs on a fixed interval — up to 30s delay | Acceptable for non-critical notifications; replace with event-driven queue for stricter SLAs |
| Redis is now a required dependency | Docker Compose handles this transparently |
| No exactly-once guarantee — edge case: ACK received but DB update fails | Client-side idempotency keys solve without server complexity |
| Users fully offline (no WS) receive nothing until reconnect | FCM/APNS layer covers mobile background delivery |

---

## Future Work

| Improvement | Why |
|---|---|
| **Kafka / RabbitMQ for event-driven retries** | Failed ACK immediately publishes to a queue — sub-second retry, no polling |
| **Push notifications (FCM / APNS)** | Cover mobile background and closed-app scenarios |
| **Exactly-once via idempotency keys** | Each notification gets a `deliveryId`; clients reject duplicates |
| **Read receipts over WebSocket** | `read` socket event instead of `PATCH /:id/read` — no extra HTTP round-trip |
| **Notification batching on reconnect** | Group all `created` into one emit — reduces frame overhead for large inboxes |
| **Delivery metrics (Prometheus + Grafana)** | Track delivery latency, ACK rates, retry counts in real time |

---

<div align="center">

Made with care by **Manjit Kumar**

</div>