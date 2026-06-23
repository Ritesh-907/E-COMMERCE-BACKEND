'use strict';

/**
 * routes/product.routes.js — Product Routes
 * ============================================
 * Base path (mounted in index.js): /api/v1/products
 *
 * Static paths (/featured) MUST be declared before dynamic ones (/:id)
 * to prevent Express treating 'featured' as an :id value.
 */

const express = require('express');

const productController    = require('../controllers/product.controller');
const { protect }          = require('../middleware/auth.middleware');
const { authorize }        = require('../middleware/authorize.middleware');
const { checkOwnership }   = require('../middleware/ownership.middleware');
const { uploadMultiple }   = require('../middleware/upload.middleware');
const { cache }            = require('../middleware/cache.middleware');
const { validate }         = require('../middleware/validate.middleware');
const {
  createProductSchema,
  updateProductSchema,
} = require('../validators/product.validator');
const Product = require('../models/Product');

// Nested review router — mergeParams exposes :productId from this router
const reviewRouter = require('./review.routes');

const router = express.Router();

// ── Mount nested review router ────────────────────────────────────────────────
// GET  /api/v1/products/:productId/reviews
// POST /api/v1/products/:productId/reviews
// etc.
router.use('/:productId/reviews', reviewRouter);

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/v1/products/featured  — MUST be before /:id
router.get('/featured', cache(3600), productController.getFeaturedProducts);

// GET /api/v1/products
router.get('/', cache(300), productController.getAllProducts);

// GET /api/v1/products/:id
router.get('/:id', productController.getProductById);

// GET /api/v1/products/:id/related
router.get('/:id/related', productController.getRelatedProducts);

// ── Protected routes ──────────────────────────────────────────────────────────

// POST /api/v1/products — admin or seller can create
router.post(
  '/',
  protect,
  authorize('admin', 'seller'),
  uploadMultiple('images', 5),
  validate(createProductSchema),
  productController.createProduct
);

// PATCH /api/v1/products/:id — only the product owner or admin
router.patch(
  '/:id',
  protect,
  authorize('admin', 'seller'),
  checkOwnership(Product, 'seller'),
  uploadMultiple('images', 5),
  validate(updateProductSchema),
  productController.updateProduct
);

// DELETE /api/v1/products/:id — admin only
router.delete(
  '/:id',
  protect,
  authorize('admin'),
  productController.deleteProduct
);

module.exports = router;