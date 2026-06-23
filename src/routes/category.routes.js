'use strict';

/**
 * routes/category.routes.js — Category Routes
 * ==============================================
 * Base path (mounted in index.js): /api/v1/categories
 */

const express = require('express');

const categoryController = require('../controllers/category.controller');
const { protect }        = require('../middleware/auth.middleware');
const { authorize }      = require('../middleware/authorize.middleware');
const { uploadSingle }   = require('../middleware/upload.middleware');
const { cache }          = require('../middleware/cache.middleware');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/v1/categories
// ?format=tree returns nested structure; default is flat list
// Cached for 1 hour — categories change rarely
router.get('/', cache(3600), categoryController.getAllCategories);

// GET /api/v1/categories/:id  (accepts both ObjectId and slug)
router.get('/:id', categoryController.getCategoryById);

// ── Admin routes ──────────────────────────────────────────────────────────────

// POST /api/v1/categories
router.post(
  '/',
  protect,
  authorize('admin'),
  uploadSingle('image'),
  categoryController.createCategory
);

// PATCH /api/v1/categories/:id
router.patch(
  '/:id',
  protect,
  authorize('admin'),
  uploadSingle('image'),
  categoryController.updateCategory
);

// DELETE /api/v1/categories/:id
router.delete(
  '/:id',
  protect,
  authorize('admin'),
  categoryController.deleteCategory
);

module.exports = router;