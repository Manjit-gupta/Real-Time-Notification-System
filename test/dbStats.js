/**
 * DB Stats — query MongoDB Notification collection and print delivery breakdown.
 *
 * Usage:
 *   node test/dbStats.js
 *
 * Reads MONGO_URI from .env
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('../src/modals/notification');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // Optional: pass a recipientId as CLI arg to scope stats
  const recipientIdStr = process.argv[2] || null;
  // Mongoose countDocuments auto-casts strings; aggregate needs an ObjectId
  const baseFilter      = recipientIdStr ? { recipientId: recipientIdStr } : {};
  const baseAggFilter   = recipientIdStr
    ? { recipientId: new mongoose.Types.ObjectId(recipientIdStr) }
    : {};

  const [total, delivered, created, maxAttempts] = await Promise.all([
    Notification.countDocuments(baseFilter),
    Notification.countDocuments({ ...baseFilter, status: 'delivered' }),
    Notification.countDocuments({ ...baseFilter, status: 'created' }),
    Notification.countDocuments({ ...baseFilter, status: 'created', deliveryAttempts: { $gte: 5 } })
  ]);

  // Distribution of deliveryAttempts for created (pending/failed) notifications
  const attemptsDist = await Notification.aggregate([
    { $match: { ...baseAggFilter, status: 'created' } },
    { $group: { _id: '$deliveryAttempts', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  // Avg attempts for delivered notifications
  const deliveredStats = await Notification.aggregate([
    { $match: { ...baseAggFilter, status: 'delivered' } },
    { $group: {
      _id: null,
      avgAttempts: { $avg: '$deliveryAttempts' },
      maxAttempts: { $max: '$deliveryAttempts' },
      firstTry: { $sum: { $cond: [{ $eq: ['$deliveryAttempts', 1] }, 1, 0] } },
      multiTry: { $sum: { $cond: [{ $gt: ['$deliveryAttempts', 1] }, 1, 0] } }
    }}
  ]);

  console.log('\n========================================');
  console.log('  NOTIFICATION DELIVERY STATS');
  console.log('========================================');
  console.log(`  Total notifications      : ${total}`);
  console.log(`  Delivered                : ${delivered} (${pct(delivered, total)})`);
  console.log(`  Pending (status=created) : ${created} (${pct(created, total)})`);
  console.log(`    - Exhausted (>=5 tries): ${maxAttempts}`);
  console.log('----------------------------------------');

  if (deliveredStats.length > 0) {
    const ds = deliveredStats[0];
    console.log(`  Delivered on first try   : ${ds.firstTry} (${pct(ds.firstTry, delivered)})`);
    console.log(`  Delivered via retry      : ${ds.multiTry} (${pct(ds.multiTry, delivered)})`);
    console.log(`  Avg delivery attempts    : ${ds.avgAttempts != null ? ds.avgAttempts.toFixed(2) : 'n/a'}`);
  } else {
    console.log('  No delivered notifications yet');
  }

  if (attemptsDist.length > 0) {
    console.log('\n  Pending — attempts distribution:');
    for (const row of attemptsDist) {
      console.log(`    attempts=${row._id}: ${row.count} notifications`);
    }
  }

  console.log('========================================\n');

  await mongoose.disconnect();
}

function pct(part, total) {
  if (!total) return '0%';
  return ((part / total) * 100).toFixed(1) + '%';
}

main().catch(err => {
  console.error('dbStats error:', err.message);
  process.exit(1);
});
