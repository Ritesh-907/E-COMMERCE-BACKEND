'use strict';

/**
 * routes/coupon.routes.js — Coupon Routes
 * ==========================================
 * Base path (mounted in index.js): /api/v1/coupons
 *
 * IMPORTANT: /stats and /validate must be declared BEFORE /:id
 * to prevent Express treating 'stats' or 'validate' as an :id value.
 */

const express = require('express');

const couponController = require('../controllers/coupon.controller');
const { protect }      = require('../middleware/auth.middleware');
const { authorize }    = require('../middleware/authorize.middleware');
const { validate }     = require('../middleware/validate.middleware');
const {
  createCouponSchema,
  updateCouponSchema,
  validateCouponBodySchema,
} = require('../validators/coupon.validator');

const router = express.Router();

// ── User route: validate a coupon ─────────────────────────────────────────────
// Accessible to any authenticated user — not admin-only

// POST /api/v1/coupons/validate — MUST be before /:id
router.post(
  '/validate',
  protect,
  validate(validateCouponBodySchema),
  couponController.validateCoupon
);

// ── Admin routes ──────────────────────────────────────────────────────────────
// All remaining routes are admin-only

// Reusable guard applied to all admin routes below
const adminGuard = [protect, authorize('admin')];

// GET /api/v1/coupons/stats — MUST be before /:id
router.get('/stats', ...adminGuard, couponController.getCouponStats);

router
  .route('/')
  .get(...adminGuard, couponController.getAllCoupons)
  .post(...adminGuard, validate(createCouponSchema), couponController.createCoupon);

router
  .route('/:id')
  .get(...adminGuard, couponController.getCouponById)
  .patch(...adminGuard, validate(updateCouponSchema), couponController.updateCoupon)
  .delete(...adminGuard, couponController.deleteCoupon);

module.exports = router;