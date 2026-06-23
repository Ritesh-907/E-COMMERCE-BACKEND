'use strict';

/**
 * routes/review.routes.js — Review Routes
 * ==========================================
 * Base path (mounted in index.js):        /api/v1/reviews
 * Also mounted in product.routes.js at:  /api/v1/products/:productId/reviews
 *
 * mergeParams: true — makes :productId from the parent product router
 * available on req.params inside review controllers.
 */

const express = require('express');

const reviewController  = require('../controllers/review.controller');
const { protect }       = require('../middleware/auth.middleware');
const { uploadMultiple } = require('../middleware/upload.middleware');
const { validate }      = require('../middleware/validate.middleware');
const {
  createReviewSchema,
  updateReviewSchema,
} = require('../validators/review.validator');

// mergeParams: true is REQUIRED for nested routing under /products/:productId/reviews
const router = express.Router({ mergeParams: true });

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/v1/products/:productId/reviews  OR  /api/v1/reviews (admin list)
router.get('/', reviewController.getProductReviews);

// ── Protected routes ──────────────────────────────────────────────────────────

// POST /api/v1/products/:productId/reviews — create a review (optional image upload)
router.post(
  '/',
  protect,
  uploadMultiple('images', 3),
  validate(createReviewSchema),
  reviewController.createReview
);

// PATCH /api/v1/reviews/:id — update own review
router.patch(
  '/:id',
  protect,
  uploadMultiple('images', 3),
  validate(updateReviewSchema),
  reviewController.updateReview
);

// DELETE /api/v1/reviews/:id — delete own review (or admin)
router.delete('/:id', protect, reviewController.deleteReview);

// POST /api/v1/reviews/:id/like — toggle like on a review
router.post('/:id/like', protect, reviewController.likeReview);

module.exports = router;