'use strict';

/**
 * routes/payment.routes.js — Payment Routes
 * ============================================
 * Base path (mounted in index.js): /api/v1/payments
 *
 * CRITICAL: The /webhook route uses express.raw() body parser which is
 * mounted in app.js BEFORE express.json(). This router does NOT re-apply
 * any body parser — it works with the raw Buffer already set on req.body.
 */

const express = require('express');

const paymentController = require('../controllers/payment.controller');
const { protect }       = require('../middleware/auth.middleware');
const { authorize }     = require('../middleware/authorize.middleware');
const { auditLog }      = require('../middleware/audit.middleware');
const { validate }      = require('../middleware/validate.middleware');
const Joi               = require('joi');

const router = express.Router();

// ── Inline validation schemas ─────────────────────────────────────────────────

const createIntentSchema = Joi.object({
  orderId: Joi.string().hex().length(24).required().messages({
    'any.required': 'Order ID is required.',
    'string.hex':   'Order ID must be a valid ID.',
  }),
});

const refundSchema = Joi.object({
  // Optional partial refund amount in USD (omit for full refund)
  amount: Joi.number().positive().precision(2).optional().messages({
    'number.positive':  'Refund amount must be a positive number.',
    'number.precision': 'Amount must have at most 2 decimal places.',
  }),
  reason: Joi.string().max(200).optional(),
});

// ── POST /api/v1/payments/create-intent ──────────────────────────────────────
// Creates a Stripe PaymentIntent and returns the clientSecret to the frontend.
// Amount is always read from the order in DB — never trusted from the client.

router.post(
  '/create-intent',
  protect,
  validate(createIntentSchema),
  paymentController.createPaymentIntent
);

// ── POST /api/v1/payments/webhook ─────────────────────────────────────────────
// Stripe calls this endpoint after payment events (success, failure, refund).
// Raw body is required for Stripe signature verification — mounted with
// express.raw({ type: 'application/json' }) in app.js.
// Does NOT use protect or asyncHandler — responds 200 immediately.

router.post('/webhook', paymentController.handleWebhook);

// ── POST /api/v1/payments/refund/:orderId ─────────────────────────────────────
// Admin-only manual refund — for customer service use.

router.post(
  '/refund/:orderId',
  protect,
  authorize('admin'),
  validate(refundSchema),
  auditLog('PAYMENT_REFUND'),
  paymentController.refundPayment
);

module.exports = router;