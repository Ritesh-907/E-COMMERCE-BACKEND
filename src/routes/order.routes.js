'use strict';

/**
 * routes/order.routes.js — Order Routes
 * ========================================
 * Base path (mounted in index.js): /api/v1/orders
 *
 * IMPORTANT: /admin/* routes are declared BEFORE /:id routes so Express
 * does not match the literal string 'admin' as a dynamic :id value.
 */

const express = require('express');

const orderController  = require('../controllers/order.controller');
const { protect }      = require('../middleware/auth.middleware');
const { authorize }    = require('../middleware/authorize.middleware');
const { validate }     = require('../middleware/validate.middleware');
const { auditLog }     = require('../middleware/audit.middleware');
const {
  createOrderSchema,
  updateOrderStatusSchema,
  cancelOrderSchema,
  trackingSchema,
} = require('../validators/order.validator');

const router = express.Router();

// All order routes require authentication
router.use(protect);

// ── Admin routes — MUST come before /:id ─────────────────────────────────────

// GET  /api/v1/orders/admin/all
router.get(
  '/admin/all',
  authorize('admin'),
  orderController.getAllOrders
);

// PATCH /api/v1/orders/admin/:id/status
router.patch(
  '/admin/:id/status',
  authorize('admin'),
  validate(updateOrderStatusSchema),
  auditLog('ADMIN_UPDATE_ORDER_STATUS'),
  orderController.updateOrderStatus
);

// PATCH /api/v1/orders/admin/:id/tracking
router.patch(
  '/admin/:id/tracking',
  authorize('admin'),
  validate(trackingSchema),
  orderController.addTrackingNumber
);

// ── Customer routes ───────────────────────────────────────────────────────────

// POST /api/v1/orders
router.post(
  '/',
  validate(createOrderSchema),
  orderController.createOrder
);

// GET /api/v1/orders/my-orders — MUST be before /:id
router.get('/my-orders', orderController.getUserOrders);

// GET /api/v1/orders/:id
router.get('/:id', orderController.getOrderById);

// PATCH /api/v1/orders/:id/cancel
router.patch(
  '/:id/cancel',
  validate(cancelOrderSchema),
  auditLog('ORDER_CANCEL'),
  orderController.cancelOrder
);

module.exports = router;