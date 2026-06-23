'use strict';

/**
 * events/product.events.js — Product Domain Event Emitter
 * =========================================================
 * Decouples product side-effects (cache invalidation, admin alerts,
 * wishlist notifications) from controllers and services.
 *
 * Events:
 *   product.created      — new product published
 *   product.outOfStock   — stock hit 0 (fired from order.service after decrement)
 *   product.backInStock  — stock replenished from 0 (fired from product.controller update)
 *   product.priceDropped — product price was reduced (fired from product.controller update)
 */

const { EventEmitter } = require('events');

const logger = require('../utils/logger');
const { NOTIFICATION_TYPE } = require('../utils/enums');

// ── Lazy imports ──────────────────────────────────────────────────────────────

const getNotificationService = () => require('../services/notification.service');
const getCacheService        = () => require('../services/cache.service');
const getAddEmailJob         = () => require('../jobs/email.job').addEmailJob;

// ── Emitter instance ──────────────────────────────────────────────────────────

const productEmitter = new EventEmitter();
productEmitter.setMaxListeners(20);

// ── product.created ───────────────────────────────────────────────────────────
// Fired by: product.controller.js → createProduct

productEmitter.on('product.created', async ({ product, seller }) => {
  // Bust the entire products cache so the new item appears in listings immediately
  try {
    await getCacheService().flush('cache:/api/v1/products*');
    logger.info('product.created: cache flushed', { productId: product._id });
  } catch (err) {
    logger.error('product.created: cache flush failed', {
      productId: product._id,
      error:     err.message,
    });
  }

  // If a seller (non-admin) created the product, notify admins for review
  if (seller && seller.role === 'seller') {
    try {
      const User = require('../models/User');
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();

      await Promise.all(
        admins.map((admin) =>
          getNotificationService().createNotification({
            userId:   admin._id,
            type:     NOTIFICATION_TYPE.SYSTEM,
            title:    'New Product Submitted',
            message:  `Seller "${seller.name}" submitted a new product: "${product.name}".`,
            link:     `/admin/products/${product._id}`,
            metadata: { productId: product._id, sellerId: seller._id },
          })
        )
      );
    } catch (err) {
      logger.error('product.created: admin notification failed', {
        productId: product._id,
        error:     err.message,
      });
    }
  }
});

// ── product.outOfStock ────────────────────────────────────────────────────────
// Fired by: services/order.service.js → decrementStock (when stock hits 0)

productEmitter.on('product.outOfStock', async ({ product }) => {
  // 1. Notify all admins
  try {
    const User   = require('../models/User');
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id email name').lean();

    await Promise.all(
      admins.map((admin) =>
        getNotificationService().createNotification({
          userId:   admin._id,
          type:     NOTIFICATION_TYPE.STOCK,
          title:    'Product Out of Stock',
          message:  `"${product.name}" (SKU: ${product.sku || product._id}) is now out of stock.`,
          link:     `/admin/products/${product._id}`,
          metadata: { productId: product._id, stock: 0 },
        })
      )
    );

    // Send low-stock alert email to admin list
    if (admins.length > 0) {
      await getAddEmailJob()('lowStock', admins[0].email, {
        adminEmail: admins[0].email,
        products:   [product],
      });
    }
  } catch (err) {
    logger.error('product.outOfStock: admin notification failed', {
      productId: product._id,
      error:     err.message,
    });
  }

  // 2. Bust product cache so out-of-stock status shows immediately
  try {
    await getCacheService().flush('cache:/api/v1/products*');
  } catch (err) {
    logger.error('product.outOfStock: cache flush failed', {
      productId: product._id,
      error:     err.message,
    });
  }
});

// ── product.backInStock ───────────────────────────────────────────────────────
// Fired by: product.controller.js → updateProduct (when stock goes from 0 to > 0)

productEmitter.on('product.backInStock', async ({ product }) => {
  // 1. Notify all users who wishlisted this product
  try {
    const Wishlist = require('../models/Wishlist');

    const wishlists = await Wishlist.find({ products: product._id })
      .populate('user', '_id name')
      .lean();

    if (wishlists.length > 0) {
      await Promise.all(
        wishlists.map(({ user }) =>
          getNotificationService().createNotification({
            userId:   user._id,
            type:     NOTIFICATION_TYPE.STOCK,
            title:    '🎉 Back in Stock!',
            message:  `"${product.name}" you saved is back in stock. Grab it before it's gone!`,
            link:     `/products/${product.slug}`,
            metadata: { productId: product._id },
          })
        )
      );

      logger.info('product.backInStock: notified wishlist users', {
        productId: product._id,
        count:     wishlists.length,
      });
    }
  } catch (err) {
    logger.error('product.backInStock: wishlist notification failed', {
      productId: product._id,
      error:     err.message,
    });
  }

  // 2. Bust product cache
  try {
    await getCacheService().flush('cache:/api/v1/products*');
  } catch (err) {
    logger.error('product.backInStock: cache flush failed', {
      productId: product._id,
      error:     err.message,
    });
  }
});

// ── product.priceDropped ──────────────────────────────────────────────────────
// Fired by: product.controller.js → updateProduct (when price decreases)
// Payload: { product, oldPrice }

productEmitter.on('product.priceDropped', async ({ product, oldPrice }) => {
  const discount     = oldPrice - product.price;
  const discountPct  = Math.round((discount / oldPrice) * 100);

  // 1. Notify all users who wishlisted this product
  try {
    const Wishlist = require('../models/Wishlist');

    const wishlists = await Wishlist.find({ products: product._id })
      .populate('user', '_id name')
      .lean();

    if (wishlists.length > 0) {
      await Promise.all(
        wishlists.map(({ user }) =>
          getNotificationService().createNotification({
            userId:   user._id,
            type:     NOTIFICATION_TYPE.PROMO,
            title:    `Price Drop: ${discountPct}% off!`,
            message:  `"${product.name}" you saved dropped from $${oldPrice.toFixed(2)} to $${product.price.toFixed(2)}.`,
            link:     `/products/${product.slug}`,
            metadata: { productId: product._id, oldPrice, newPrice: product.price },
          })
        )
      );

      logger.info('product.priceDropped: notified wishlist users', {
        productId:   product._id,
        oldPrice,
        newPrice:    product.price,
        userCount:   wishlists.length,
      });
    }
  } catch (err) {
    logger.error('product.priceDropped: wishlist notification failed', {
      productId: product._id,
      error:     err.message,
    });
  }

  // 2. Bust product cache
  try {
    await getCacheService().flush('cache:/api/v1/products*');
  } catch (err) {
    logger.error('product.priceDropped: cache flush failed', {
      productId: product._id,
      error:     err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = productEmitter;