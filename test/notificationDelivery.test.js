'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../src/config/redis', () => ({
  pubClient: { sCard: jest.fn() }
}));

jest.mock('../src/socket/io', () => ({
  getIO: jest.fn()
}));

jest.mock('../src/modals/notification', () => ({
  findByIdAndUpdate: jest.fn()
}));

const { pubClient }          = require('../src/config/redis');
const { getIO }              = require('../src/socket/io');
const Notification           = require('../src/modals/notification');
const { deliverNotification } = require('../src/services/notificationDelivery');

// ─── Helper ───────────────────────────────────────────────────────────────────
function makeNotification(overrides = {}) {
  return {
    _id:         'notif-123',
    recipientId: { toString: () => 'user-abc' },
    type:        'follow',
    data:        { message: 'Alice followed you.' },
    createdAt:   new Date('2026-03-01T00:00:00Z'),
    ...overrides
  };
}

function makeIO(emitWithAckImpl) {
  const mockEmitWithAck = jest.fn(emitWithAckImpl);
  const mockTo          = jest.fn().mockReturnValue({ emitWithAck: mockEmitWithAck });
  const mockTimeout     = jest.fn().mockReturnValue({ to: mockTo });
  return { io: { timeout: mockTimeout }, mockEmitWithAck, mockTo, mockTimeout };
}

beforeEach(() => {
  jest.clearAllMocks();
  Notification.findByIdAndUpdate.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — Online user + ACK received (success path)
// ─────────────────────────────────────────────────────────────────────────────
describe('Test 1 — Online user + ACK received', () => {
  it('marks notification as delivered when at least one socket ACKs', async () => {
    pubClient.sCard.mockResolvedValue(1);                     // user is online
    const { io, mockEmitWithAck } = makeIO(() => Promise.resolve([undefined])); // one ACK
    getIO.mockReturnValue(io);

    await deliverNotification(makeNotification());

    expect(mockEmitWithAck).toHaveBeenCalledTimes(1);
    expect(Notification.findByIdAndUpdate).toHaveBeenCalledWith(
      'notif-123',
      expect.objectContaining({
        status:      'delivered',
        deliveredAt: expect.any(Date),
        $inc:        { deliveryAttempts: 1 },
        lastAttemptAt: expect.any(Date)
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — Online user + NO ACK (timeout path)
// ─────────────────────────────────────────────────────────────────────────────
describe('Test 2 — Online user + NO ACK (timeout)', () => {
  it('increments deliveryAttempts and leaves status as "created" on timeout', async () => {
    pubClient.sCard.mockResolvedValue(1);                     // user is online
    const timeoutErr = Object.assign(new Error('operation has timed out'), { responses: [] });
    const { io, mockEmitWithAck } = makeIO(() => Promise.reject(timeoutErr));
    getIO.mockReturnValue(io);

    await deliverNotification(makeNotification());

    expect(mockEmitWithAck).toHaveBeenCalledTimes(1);
    expect(Notification.findByIdAndUpdate).toHaveBeenCalledWith(
      'notif-123',
      expect.objectContaining({
        $inc:          { deliveryAttempts: 1 },
        lastAttemptAt: expect.any(Date)
      })
    );
    // Must NOT set status = 'delivered'
    const call = Notification.findByIdAndUpdate.mock.calls[0][1];
    expect(call.status).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — User offline
// ─────────────────────────────────────────────────────────────────────────────
describe('Test 3 — User offline', () => {
  it('exits early without emitting or touching the DB', async () => {
    pubClient.sCard.mockResolvedValue(0);                     // user is offline
    const { io } = makeIO();
    getIO.mockReturnValue(io);

    await deliverNotification(makeNotification());

    expect(io.timeout).not.toHaveBeenCalled();
    expect(Notification.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — Retry success after failure
// ─────────────────────────────────────────────────────────────────────────────
describe('Test 4 — Retry success after failure', () => {
  it('first attempt times out then second attempt delivers successfully', async () => {
    pubClient.sCard.mockResolvedValue(1);

    // First attempt: timeout
    const timeoutErr = Object.assign(new Error('operation has timed out'), { responses: [] });
    const { io: io1, mockEmitWithAck: ack1 } = makeIO(() => Promise.reject(timeoutErr));
    getIO.mockReturnValueOnce(io1);

    await deliverNotification(makeNotification());

    expect(ack1).toHaveBeenCalledTimes(1);
    expect(Notification.findByIdAndUpdate).toHaveBeenLastCalledWith(
      'notif-123',
      expect.objectContaining({ $inc: { deliveryAttempts: 1 } })
    );
    const firstCall = Notification.findByIdAndUpdate.mock.calls[0][1];
    expect(firstCall.status).toBeUndefined();   // still 'created'

    Notification.findByIdAndUpdate.mockClear();

    // Second attempt: ACK received
    const { io: io2, mockEmitWithAck: ack2 } = makeIO(() => Promise.resolve([undefined]));
    getIO.mockReturnValueOnce(io2);

    await deliverNotification(makeNotification());

    expect(ack2).toHaveBeenCalledTimes(1);
    expect(Notification.findByIdAndUpdate).toHaveBeenCalledWith(
      'notif-123',
      expect.objectContaining({ status: 'delivered' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — Multiple devices (partial ACK)
// ─────────────────────────────────────────────────────────────────────────────
describe('Test 5 — Multiple devices, partial ACK', () => {
  it('marks delivered when at least one of three devices ACKs', async () => {
    pubClient.sCard.mockResolvedValue(3);                // 3 sockets online
    // emitWithAck for a room resolves with one array — responses from all sockets
    // One device ACKs (undefined), others did not call ack before resolution
    const { io, mockEmitWithAck } = makeIO(() => Promise.resolve([undefined])); // net: 1 ACK
    getIO.mockReturnValue(io);

    await deliverNotification(makeNotification());

    expect(mockEmitWithAck).toHaveBeenCalledTimes(1);
    expect(Notification.findByIdAndUpdate).toHaveBeenCalledWith(
      'notif-123',
      expect.objectContaining({ status: 'delivered' })
    );
  });
});
