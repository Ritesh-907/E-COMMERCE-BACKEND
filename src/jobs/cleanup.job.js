
'use strict';

/**
 * jobs/cleanup.job.js — Scheduled Database Cleanup
 * ==================================================
 * Runs housekeeping tasks on a schedule using node-cron.
 * All jobs are wrapped in try/catch — one failure never stops the others.
 *
 * Schedule:
 *   deleteExpiredTokens     — daily   at midnight     (0 0 * * *)
 *   deleteOldNotifications  — weekly  Sunday at 2 AM  (0 2 * * 0)
 *   cancelAbandonedOrders   — every 6 hours           (0 *\/6 * * *)
 */

const cron         = require('node-cron');
const mongoose     = require('mongoose');
const RefreshToken = require('../models/RefreshToken');
const Notification = require('../models/Notification');
const Order        = require('../models/Order');
const logger       = require('../utils/logger');
const { ORDER_STATUS } = require('../utils/enums');

// Lazy import to avoid circular deps at startup
const getOrderService = () => require('../services/order.service');

// ── deleteExpiredTokens ───────────────────────────────────────────────────────
// Removes all RefreshToken documents whose expiresAt has passed.
// The JWT itself is already invalid by then, but the DB record should be
// cleaned up to prevent unbounded collection growth.

async function deleteExpiredTokens() {
  const jobName = 'deleteExpiredTokens';
  logger.info(`[${jobName}] Starting`);

  try {
    const result = await RefreshToken.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    logger.info(`[${jobName}] Completed`, {
      deleted: result.deletedCount,
    });
  } catch (err) {
    logger.error(`[${jobName}] Failed`, { error: err.message });
  }
}

// ── deleteOldNotifications ────────────────────────────────────────────────────
// Removes read notifications older than 30 days.
// Unread notifications are preserved regardless of age.
// NOTE: A TTL index on the Notification model (`createdAt`, expireAfterSeconds)
// would also handle this automatically, but the cron job gives us control over
// whether to preserve unread ones.

async function deleteOldNotifications() {
  const jobName  = 'deleteOldNotifications';
  const cutoff   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  logger.info(`[${jobName}] Starting`, { cutoff });

  try {
    const result = await Notification.deleteMany({
      isRead:    true,
      createdAt: { $lt: cutoff },
    });

    logger.info(`[${jobName}] Completed`, {
      deleted: result.deletedCount,
    });
  } catch (err) {
    logger.error(`[${jobName}] Failed`, { error: err.message });
  }
}

// ── cancelAbandonedOrders ─────────────────────────────────────────────────────
// Finds pending card-payment orders that are older than 24 hours and
// still unpaid, then cancels them and restores stock.
//
// Why 24 hours?
//   Stripe PaymentIntents expire after 24 h by default. Any order that
//   remains unpaid past that window will never be paid.
//
// COD orders are excluded — they are meant to be paid on delivery.

async function cancelAbandonedOrders() {
  const jobName  = 'cancelAbandonedOrders';
  const cutoff   = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  logger.info(`[${jobName}] Starting`, { cutoff });

  try {
    const abandonedOrders = await Order.find({
      orderStatus:   ORDER_STATUS.PENDING,
      paymentMethod: 'card',
      isPaid:        false,
      createdAt:     { $lt: cutoff },
    });

    if (abandonedOrders.length === 0) {
      logger.info(`[${jobName}] No abandoned orders found`);
      return;
    }

    const orderService = getOrderService();
    let cancelledCount = 0;

    // Process sequentially to avoid hammering the DB
    for (const order of abandonedOrders) {
      try {
        // Restore stock for each item
        await orderService.restoreStock(order.items);

        order.orderStatus  = ORDER_STATUS.CANCELLED;
        order.cancelReason = 'Payment timeout — order automatically cancelled after 24 hours.';
        await order.save({ validateBeforeSave: false });

        cancelledCount++;
      } catch (err) {
        logger.error(`[${jobName}] Failed to cancel order`, {
          orderId: order._id,
          error:   err.message,
        });
        // Continue with next order — don't abort the whole batch
      }
    }

    logger.info(`[${jobName}] Completed`, {
      found:     abandonedOrders.length,
      cancelled: cancelledCount,
    });
  } catch (err) {
    logger.error(`[${jobName}] Failed`, { error: err.message });
  }
}

// ── Redis distributed lock helper ─────────────────────────────────────────────
// In multi-instance deployments (k8s, PM2 cluster) all pods share the same
// cron schedule. Without a lock, each pod runs the same cleanup — which wastes
// resources but is otherwise safe (deletions are idempotent). If you want only
// one pod to run each job, wrap each call with acquireLock / releaseLock below.

async function acquireLock(key, ttlSeconds = 120) {
  try {
    const { redisClient } = require('../config/redis');
    // NX = only set if key does NOT exist; EX = TTL in seconds
    const result = await redisClient.set(
      `lock:${key}`,
      process.pid,
      'NX',
      'EX',
      ttlSeconds
    );
    return result === 'OK'; // true = lock acquired; false = another pod holds it
  } catch {
    // Redis unavailable — let the job run anyway (degrade gracefully)
    return true;
  }
}

async function releaseLock(key) {
  try {
    const { redisClient } = require('../config/redis');
    await redisClient.del(`lock:${key}`);
  } catch {
    // Non-fatal
  }
}

// Wraps a job function with a distributed lock so only one pod executes it
function withLock(lockKey, fn) {
  return async () => {
    const acquired = await acquireLock(lockKey);
    if (!acquired) {
      logger.debug(`[${lockKey}] Skipping — another instance holds the lock`);
      return;
    }
    try {
      await fn();
    } finally {
      await releaseLock(lockKey);
    }
  };
}

// ── initCleanupJobs ───────────────────────────────────────────────────────────

function initCleanupJobs() {
  // Daily at midnight — remove expired refresh tokens
  cron.schedule('0 0 * * *', withLock('cleanup:tokens', deleteExpiredTokens), {
    timezone: 'UTC',
  });

  // Every Sunday at 2 AM — remove old read notifications
  cron.schedule('0 2 * * 0', withLock('cleanup:notifications', deleteOldNotifications), {
    timezone: 'UTC',
  });

  // Every 6 hours — cancel abandoned (unpaid) card orders
  cron.schedule('0 */6 * * *', withLock('cleanup:abandoned-orders', cancelAbandonedOrders), {
    timezone: 'UTC',
  });

  logger.info('Cleanup jobs initialized', {
    jobs: [
      'deleteExpiredTokens     (daily @ midnight UTC)',
      'deleteOldNotifications  (weekly Sunday @ 02:00 UTC)',
      'cancelAbandonedOrders   (every 6 hours)',
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  initCleanupJobs,
  // Exported for use in tests or manual admin triggers
  deleteExpiredTokens,
  deleteOldNotifications,
  cancelAbandonedOrders,
};