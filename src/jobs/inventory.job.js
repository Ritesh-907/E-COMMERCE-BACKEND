'use strict';

/**
 * jobs/inventory.job.js — Inventory Monitoring & Alerts
 * ========================================================
 * Runs daily at 9 AM UTC. Finds products at or below LOW_STOCK_THRESHOLD,
 * notifies all admins via email + in-app notification, and optionally
 * auto-unpublishes products that are completely out of stock.
 */

const cron    = require('node-cron');
const Product = require('../models/Product');
const User    = require('../models/User');
const logger  = require('../utils/logger');
const { LOW_STOCK_THRESHOLD } = require('../utils/constants');
const { NOTIFICATION_TYPE }   = require('../utils/enums');

// Lazy imports to avoid circular deps
const getNotificationService = () => require('../services/notification.service');
const getAddEmailJob         = () => require('../jobs/email.job').addEmailJob;

// ── checkLowStock ─────────────────────────────────────────────────────────────

async function checkLowStock() {
  const jobName = 'checkLowStock';
  logger.info(`[${jobName}] Starting`);

  try {
    // Find all published products at or below the threshold, sorted by stock asc
    // so the most urgent (0 stock) appear first in the alert email
    const atRiskProducts = await Product.find({
      isPublished: true,
      stock:       { $lte: LOW_STOCK_THRESHOLD },
    })
      .sort({ stock: 1 })
      .limit(50)
      .select('name sku slug stock images price category')
      .lean();

    if (atRiskProducts.length === 0) {
      logger.info(`[${jobName}] All products sufficiently stocked`);
      return;
    }

    // Split into two buckets for the alert email
    const outOfStock = atRiskProducts.filter((p) => p.stock === 0);
    const lowStock   = atRiskProducts.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD);

    logger.info(`[${jobName}] Products requiring attention`, {
      outOfStock: outOfStock.length,
      lowStock:   lowStock.length,
    });

    // ── Auto-unpublish out-of-stock products (optional) ───────────────────────
    // Setting isPublished: false prevents customers from seeing items they
    // can't buy. Re-publish manually or via the product.backInStock event.
    if (outOfStock.length > 0) {
      const ids = outOfStock.map((p) => p._id);
      const { modifiedCount } = await Product.updateMany(
        { _id: { $in: ids } },
        { isPublished: false }
      );
      logger.info(`[${jobName}] Auto-unpublished ${modifiedCount} out-of-stock product(s)`);
    }

    // ── Fetch admin recipients ────────────────────────────────────────────────
    const admins = await User.find({ role: 'admin', isActive: true })
      .select('_id name email')
      .lean();

    if (admins.length === 0) {
      logger.warn(`[${jobName}] No active admins found — skipping notifications`);
      return;
    }

    // ── In-app notifications ──────────────────────────────────────────────────
    const notificationService = getNotificationService();

    const notificationMessage = [
      outOfStock.length > 0 ? `${outOfStock.length} product(s) are out of stock.` : '',
      lowStock.length   > 0 ? `${lowStock.length} product(s) are running low.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    await Promise.allSettled(
      admins.map((admin) =>
        notificationService.createNotification({
          userId:   admin._id,
          type:     NOTIFICATION_TYPE.STOCK,
          title:    '⚠️ Inventory Alert',
          message:  notificationMessage,
          link:     '/admin/products?filter=lowStock',
          metadata: {
            outOfStockCount: outOfStock.length,
            lowStockCount:   lowStock.length,
          },
        })
      )
    );

    // ── Alert emails ──────────────────────────────────────────────────────────
    // Send to each admin independently so one bad email address doesn't block others.
    const addEmailJob = getAddEmailJob();

    await Promise.allSettled(
      admins.map((admin) =>
        addEmailJob('lowStock', admin.email, {
          adminEmail: admin.email,
          adminName:  admin.name,
          products:   atRiskProducts,
          outOfStock,
          lowStock,
          threshold:  LOW_STOCK_THRESHOLD,
          generatedAt: new Date().toISOString(),
        })
      )
    );

    logger.info(`[${jobName}] Completed`, {
      notified:    admins.length,
      outOfStock:  outOfStock.length,
      lowStock:    lowStock.length,
    });
  } catch (err) {
    logger.error(`[${jobName}] Failed`, {
      error: err.message,
      stack: err.stack,
    });
  }
}

// ── initInventoryJobs ─────────────────────────────────────────────────────────

function initInventoryJobs() {
  // Daily at 9 AM UTC — catches issues at the start of the business day
  cron.schedule('0 9 * * *', checkLowStock, {
    timezone: 'UTC',
  });

  logger.info('Inventory jobs initialized', {
    jobs: ['checkLowStock (daily @ 09:00 UTC)'],
    lowStockThreshold: LOW_STOCK_THRESHOLD,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  initInventoryJobs,
  // Export for tests and manual admin triggers (e.g. POST /admin/jobs/inventory)
  checkLowStock,
};