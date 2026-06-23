'use strict';

/**
 * routes/cart.routes.js — Shopping Cart Routes
 * ===============================================
 * Base path (mounted in index.js): /api/v1/cart
 */

const express = require('express');

const cartController = require('../controllers/cart.controller');
const { protect }    = require('../middleware/auth.middleware');
const { validate }   = require('../middleware/validate.middleware');
const Joi            = require('joi');

const router = express.Router();

// All cart routes require authentication
router.use(protect);

// ── Inline validation schemas (small enough to avoid a separate file) ─────────

const addToCartSchema = Joi.object({
  productId: Joi.string().hex().length(24).required().messages({
    'any.required': 'Product ID is required.',
    'string.hex':   'Product ID must be a valid ID.',
  }),
  quantity: Joi.number().integer().min(1).max(100).optional().default(1),
});

const updateCartItemSchema = Joi.object({
  quantity: Joi.number().integer().min(0).max(100).required().messages({
    'any.required': 'Quantity is required.',
    'number.min':   'Quantity must be 0 (to remove) or a positive number.',
  }),
});

const applyCouponSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(3).max(20).required().messages({
    'any.required': 'Coupon code is required.',
  }),
});

// ── Cart ──────────────────────────────────────────────────────────────────────

router
  .route('/')
  .get(cartController.getCart)
  .delete(cartController.clearCart);

// ── Cart items ────────────────────────────────────────────────────────────────

router.post(
  '/items',
  validate(addToCartSchema),
  cartController.addToCart
);

router
  .route('/items/:itemId')
  .patch(validate(updateCartItemSchema), cartController.updateCartItem)
  .delete(cartController.removeFromCart);

// ── Coupon ────────────────────────────────────────────────────────────────────

router
  .route('/coupon')
  .post(validate(applyCouponSchema), cartController.applyCoupon)
  .delete(cartController.removeCoupon);

module.exports = router;