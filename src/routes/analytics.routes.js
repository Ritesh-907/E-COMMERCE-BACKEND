'use strict';

/**
 * routes/analytics.routes.js — Analytics Routes
 * ================================================
 * Base path (mounted in index.js): /api/v1/analytics
 * All routes are admin-only.
 */

const express = require('express');

const analyticsController = require('../controllers/analytics.controller');
const { protect }         = require('../middleware/auth.middleware');
const { authorize }       = require('../middleware/authorize.middleware');
const { validate }        = require('../middleware/validate.middleware');
const Joi                 = require('joi');

const router = express.Router();

// Apply auth + admin role to every route in this file
router.use(protect, authorize('admin'));

// ── Inline query validation ───────────────────────────────────────────────────

const revenueQuerySchema = Joi.object({
  period: Joi.string().valid('daily', 'weekly', 'monthly').optional(),
  from:   Joi.date().iso().optional(),
  to:     Joi.date().iso().min(Joi.ref('from')).optional().messages({
    'date.min': '"to" date must be after "from" date.',
  }),
}).options({ allowUnknown: false });

const topProductsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/v1/analytics/dashboard — overall KPI summary (cached 5 min)
router.get('/dashboard', analyticsController.getDashboardStats);

// GET /api/v1/analytics/revenue?period=daily&from=2024-01-01&to=2024-01-31
router.get(
  '/revenue',
  validate(revenueQuerySchema, 'query'),
  analyticsController.getRevenueChart
);

// GET /api/v1/analytics/top-products?limit=10
router.get(
  '/top-products',
  validate(topProductsQuerySchema, 'query'),
  analyticsController.getTopProducts
);

// GET /api/v1/analytics/top-categories
router.get('/top-categories', analyticsController.getTopCategories);

// GET /api/v1/analytics/user-growth
router.get('/user-growth', analyticsController.getUserGrowth);

module.exports = router;