'use strict';

/**
 * routes/wishlist.routes.js — Wishlist Routes
 * ==============================================
 * Base path (mounted in index.js): /api/v1/wishlist
 */

const express = require('express');

const wishlistController = require('../controllers/wishlist.controller');
const { protect }        = require('../middleware/auth.middleware');
const { validate }       = require('../middleware/validate.middleware');
const Joi                = require('joi');

const router = express.Router();

// All wishlist routes require authentication
router.use(protect);

// ── Inline schema ─────────────────────────────────────────────────────────────

const wishlistItemSchema = Joi.object({
  productId: Joi.string().hex().length(24).required().messages({
    'any.required': 'Product ID is required.',
    'string.hex':   'Product ID must be a valid ID.',
  }),
});

// ── Routes ────────────────────────────────────────────────────────────────────

router
  .route('/')
  .get(wishlistController.getWishlist)
  .post(validate(wishlistItemSchema), wishlistController.addToWishlist);

// DELETE /api/v1/wishlist/:productId
router.delete('/:productId', wishlistController.removeFromWishlist);

// POST /api/v1/wishlist/:productId/move-to-cart
router.post('/:productId/move-to-cart', wishlistController.moveToCart);

module.exports = router;