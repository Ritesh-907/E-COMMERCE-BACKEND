'use strict';

/**
 * scripts/backfillPaymentEmail.js — Backfill paymentResult.email_address
 * =========================================================================
 * One-off fix for orders created before receipt_email was passed to Stripe
 * at PaymentIntent creation time. For every paid order whose
 * paymentResult.email_address is empty, looks up the order's user and
 * fills in their email.
 *
 * USAGE:
 *   node scripts/backfillPaymentEmail.js              → dry run (no writes)
 *   node scripts/backfillPaymentEmail.js --apply      → actually update documents
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const logger = require('../src/utils/logger');

const APPLY = process.argv.includes('--apply');

async function run() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    logger.error('MONGO_URI is not defined in environment variables');
    process.exit(1);
  }

  await mongoose.connect(uri);
  logger.info('Connected to MongoDB', { host: mongoose.connection.host });

  // Orders that were paid but have no email_address recorded yet.
  const cursor = Order.find({
    isPaid: true,
    $or: [
      { 'paymentResult.email_address': { $exists: false } },
      { 'paymentResult.email_address': '' },
      { 'paymentResult.email_address': null },
    ],
  }).cursor();

  let scanned = 0;
  let updated = 0;
  let skippedNoUser = 0;
  let skippedNoPaymentResult = 0;

  for await (const order of cursor) {
    scanned += 1;

    if (!order.paymentResult) {
      skippedNoPaymentResult += 1;
      continue;
    }

    const user = await User.findById(order.user).select('email').lean();

    if (!user || !user.email) {
      skippedNoUser += 1;
      logger.warn('Skipping order — user not found or has no email', {
        orderId: order._id.toString(),
        userId: order.user?.toString(),
      });
      continue;
    }

    if (APPLY) {
      await Order.updateOne(
        { _id: order._id },
        { $set: { 'paymentResult.email_address': user.email } },
      );
    }

    updated += 1;
    logger.info(`${APPLY ? 'Updated' : '[DRY RUN] Would update'} order`, {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      email: user.email,
    });
  }

  logger.info('Backfill complete', {
    mode: APPLY ? 'APPLY' : 'DRY RUN',
    scanned,
    updated,
    skippedNoUser,
    skippedNoPaymentResult,
  });

  if (!APPLY && updated > 0) {
    logger.info('Re-run with --apply to write these changes.');
  }

  await mongoose.connection.close();
}

run().catch((err) => {
  logger.error('Backfill failed', { error: err.message, stack: err.stack });
  process.exit(1);
});