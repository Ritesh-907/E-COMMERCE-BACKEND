'use strict';

/**
 * routes/index.js — Central API Router
 * =======================================
 * Mounts all domain routers under /api/v1.
 * Imported and used in app.js:
 *   app.use('/api/v1', require('./routes/index'))
 *
 * Route map:
 *   GET  /api/v1/health          → liveness probe
 *   *    /api/v1/auth            → auth.routes.js
 *   *    /api/v1/users           → user.routes.js
 *   *    /api/v1/products        → product.routes.js
 *   *    /api/v1/categories      → category.routes.js
 *   *    /api/v1/orders          → order.routes.js
 *   *    /api/v1/cart            → cart.routes.js
 *   *    /api/v1/reviews         → review.routes.js
 *   *    /api/v1/coupons         → coupon.routes.js
 *   *    /api/v1/payments        → payment.routes.js
 *   *    /api/v1/wishlist        → wishlist.routes.js
 *   *    /api/v1/analytics       → analytics.routes.js
 */

const express = require('express');

const authRouter      = require('./auth.routes');
const userRouter      = require('./user.routes');
const productRouter   = require('./product.routes');
const categoryRouter  = require('./category.routes');
const orderRouter     = require('./order.routes');
const cartRouter      = require('./cart.routes');
const reviewRouter    = require('./review.routes');
const couponRouter    = require('./coupon.routes');
const paymentRouter   = require('./payment.routes');
const wishlistRouter  = require('./wishlist.routes');
const analyticsRouter = require('./analytics.routes');

const logger = require('../utils/logger');

const router = express.Router();

// ── Health check ──────────────────────────────────────────────────────────────
// Used by load balancers (ALB, nginx), Docker HEALTHCHECK, and k8s liveness probes.
// Intentionally lightweight — no DB or Redis ping (use /api/v1/health/deep for that).
// Suppressed by Morgan logger (skip list in logger.middleware.js) to avoid log noise.

router.get('/health', (req, res) => {
  res.status(200).json({
    success:   true,
    status:    'healthy',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    pid:       process.pid,
    env:       process.env.NODE_ENV,
    version:   process.env.npm_package_version || '1.0.0',
  });
});

// ── Deep health check (optional, authenticated) ───────────────────────────────
// Pings MongoDB and Redis — useful for admin dashboards and readiness probes.
// Not included in the standard health check to keep it fast.

router.get('/health/deep', async (req, res) => {
  const checks = { mongo: 'unknown', redis: 'unknown' };
  let   status = 200;

  // MongoDB
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      checks.mongo = 'healthy';
    } else {
      checks.mongo = 'unhealthy';
      status       = 503;
    }
  } catch {
    checks.mongo = 'unhealthy';
    status       = 503;
  }

  // Redis
  try {
    const { redisClient } = require('../config/redis');
    if (redisClient && redisClient.status === 'ready') {
      checks.redis = 'healthy';
    } else {
      checks.redis = 'degraded'; // Redis down = degraded, not fully unhealthy
    }
  } catch {
    checks.redis = 'degraded';
  }

  logger.debug('Deep health check', { checks, status });

  res.status(status).json({
    success:   status === 200,
    status:    status === 200 ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// ── Domain routers ────────────────────────────────────────────────────────────

router.use('/auth',      authRouter);
router.use('/users',     userRouter);
router.use('/products',  productRouter);
router.use('/categories',categoryRouter);
router.use('/orders',    orderRouter);
router.use('/cart',      cartRouter);
router.use('/reviews',   reviewRouter);
router.use('/coupons',   couponRouter);
router.use('/payments',  paymentRouter);
router.use('/wishlist',  wishlistRouter);
router.use('/analytics', analyticsRouter);

module.exports = router;