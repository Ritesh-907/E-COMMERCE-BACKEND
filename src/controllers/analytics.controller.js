"use strict";

/**
 * controllers/analytics.controller.js — Admin Analytics Dashboard
 * =================================================================
 * All routes are admin-only. Heavy aggregations are cached via analyticsService.
 */

const analyticsService = require("../services/analytics.service");
const cacheService = require("../services/cache.service");
const Order = require("../models/Order");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/response");
const { CACHE_TTL } = require("../utils/constants");
const logger = require("../utils/logger");

// ── getDashboardStats ─────────────────────────────────────────────────────────

exports.getDashboardStats = asyncHandler(async (req, res) => {
  const cacheKey = "analytics:dashboard";

  const stats = await cacheService.remember(
    cacheKey,
    CACHE_TTL.ANALYTICS, // 5 minutes
    () => analyticsService.getDashboardStats(),
  );

  successResponse(res, { stats });
});

// ── getRevenueChart ───────────────────────────────────────────────────────────

exports.getRevenueChart = asyncHandler(async (req, res) => {
  const { period = "daily", from, to } = req.query;

  const validPeriods = ["daily", "weekly", "monthly"];
  if (!validPeriods.includes(period)) {
    throw new AppError(
      `Invalid period. Must be one of: ${validPeriods.join(", ")}.`,
      400,
    );
  }

  // Default: last 30 days
  const endDate = to ? new Date(to) : new Date();
  const startDate = from
    ? new Date(from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (isNaN(startDate) || isNaN(endDate)) {
    throw new AppError(
      "Invalid date format. Use ISO 8601 (e.g. 2024-01-01).",
      400,
    );
  }

  if (startDate > endDate) {
    throw new AppError('"from" date must be before "to" date.', 400);
  }

  const cacheKey = `analytics:revenue:${period}:${startDate.toISOString()}:${endDate.toISOString()}`;

  const chartData = await cacheService.remember(
    cacheKey,
    CACHE_TTL.ANALYTICS,
    () => analyticsService.getRevenueByPeriod(startDate, endDate, period),
  );

  successResponse(res, { period, from: startDate, to: endDate, chartData });
});

// ── getTopProducts ────────────────────────────────────────────────────────────

exports.getTopProducts = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const cacheKey = `analytics:top-products:${limit}`;

  const products = await cacheService.remember(
    cacheKey,
    CACHE_TTL.ANALYTICS,
    () => analyticsService.getTopSellingProducts(limit),
  );

  successResponse(res, { products });
});

// ── getTopCategories ──────────────────────────────────────────────────────────

exports.getTopCategories = asyncHandler(async (req, res) => {
  const cacheKey = "analytics:top-categories";

  const categories = await cacheService.remember(
    cacheKey,
    CACHE_TTL.ANALYTICS,
    async () => {
      return Order.aggregate([
        // Only count paid orders
        { $match: { isPaid: true } },
        // Flatten the items array
        { $unwind: "$items" },
        // Join to products to get the category
        {
          $lookup: {
            from: "products",
            localField: "items.product",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: { path: "$productDoc", preserveNullAndEmpty: false } },
        // Join to categories for the name
        {
          $lookup: {
            from: "categories",
            localField: "productDoc.category",
            foreignField: "_id",
            as: "categoryDoc",
          },
        },
        { $unwind: { path: "$categoryDoc", preserveNullAndEmpty: false } },
        // Group by category
        {
          $group: {
            _id: "$categoryDoc._id",
            name: { $first: "$categoryDoc.name" },
            slug: { $first: "$categoryDoc.slug" },
            revenue: {
              $sum: { $multiply: ["$items.price", "$items.quantity"] },
            },
            unitsSold: { $sum: "$items.quantity" },
            orderCount: { $addToSet: "$_id" },
          },
        },
        {
          $project: {
            name: 1,
            slug: 1,
            revenue: 1,
            unitsSold: 1,
            orderCount: { $size: "$orderCount" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]);
    },
  );

  successResponse(res, { categories });
});

// ── getUserGrowth ─────────────────────────────────────────────────────────────

exports.getUserGrowth = asyncHandler(async (req, res) => {
  const cacheKey = "analytics:user-growth";

  const data = await cacheService.remember(cacheKey, CACHE_TTL.ANALYTICS, () =>
    analyticsService.getUserStats(),
  );

  successResponse(res, { data });
});
