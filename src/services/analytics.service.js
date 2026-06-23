'use strict';

/**
 * services/analytics.service.js — Admin Dashboard Analytics
 * ===========================================================
 * All functions run MongoDB aggregation pipelines.
 * Results are cached by analytics.job.js (hourly) and analytics.controller.js
 * (5-min TTL via cacheService.remember) — these functions are never called
 * on every dashboard page load.
 */

const mongoose = require('mongoose');
const Order    = require('../models/Order');
const User     = require('../models/User');
const Product  = require('../models/Product');
const logger   = require('../utils/logger');

// ── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date = new Date()) {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── getDashboardStats ─────────────────────────────────────────────────────────

/**
 * Returns overall KPI summary for the admin dashboard in one aggregation pass.
 *
 * @returns {Promise<{
 *   totalRevenue:    number,
 *   revenueToday:   number,
 *   revenueThisMonth: number,
 *   ordersByStatus: object,
 *   totalOrders:    number,
 *   ordersToday:    number,
 *   totalUsers:     number,
 *   newUsersToday:  number,
 *   lowStockCount:  number,
 *   topProduct:     object|null
 * }>}
 */
async function getDashboardStats() {
  const todayStart  = startOfDay();
  const monthStart  = startOfMonth();

  // ── Orders aggregation (single round-trip via $facet) ────────────────────
  const [orderStats] = await Order.aggregate([
    {
      $facet: {
        totalRevenue: [
          { $match: { isPaid: true } },
          { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ],
        revenueToday: [
          { $match: { isPaid: true, paidAt: { $gte: todayStart } } },
          { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ],
        revenueThisMonth: [
          { $match: { isPaid: true, paidAt: { $gte: monthStart } } },
          { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ],
        ordersByStatus: [
          { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
        ],
        totalOrders: [
          { $count: 'count' },
        ],
        ordersToday: [
          { $match: { createdAt: { $gte: todayStart } } },
          { $count: 'count' },
        ],
        topProduct: [
          { $match: { isPaid: true } },
          { $unwind: '$items' },
          {
            $group: {
              _id:  '$items.product',
              name: { $first: '$items.name' },
              sold: { $sum:  '$items.quantity' },
            },
          },
          { $sort: { sold: -1 } },
          { $limit: 1 },
        ],
      },
    },
  ]);

  // ── User stats ────────────────────────────────────────────────────────────
  const [userStats] = await User.aggregate([
    {
      $facet: {
        total: [{ $count: 'count' }],
        today: [
          { $match: { createdAt: { $gte: todayStart } } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  // ── Low stock count ───────────────────────────────────────────────────────
  const { LOW_STOCK_THRESHOLD } = require('../utils/constants');
  const lowStockCount = await Product.countDocuments({
    isPublished: true,
    stock:       { $lte: LOW_STOCK_THRESHOLD },
  });

  // ── Shape the status map ──────────────────────────────────────────────────
  const ordersByStatus = {};
  (orderStats.ordersByStatus || []).forEach(({ _id, count }) => {
    ordersByStatus[_id] = count;
  });

  return {
    totalRevenue:     orderStats.totalRevenue[0]?.total      || 0,
    revenueToday:     orderStats.revenueToday[0]?.total      || 0,
    revenueThisMonth: orderStats.revenueThisMonth[0]?.total  || 0,
    ordersByStatus,
    totalOrders:      orderStats.totalOrders[0]?.count       || 0,
    ordersToday:      orderStats.ordersToday[0]?.count       || 0,
    totalUsers:       userStats.total[0]?.count              || 0,
    newUsersToday:    userStats.today[0]?.count              || 0,
    lowStockCount,
    topProduct:       orderStats.topProduct[0]               || null,
  };
}

// ── getRevenueByPeriod ────────────────────────────────────────────────────────

/**
 * Revenue chart data grouped by day, week, or month.
 *
 * @param  {Date}   startDate
 * @param  {Date}   endDate
 * @param  {'daily'|'weekly'|'monthly'} period
 * @returns {Promise<Array<{ _id: string, revenue: number, orderCount: number }>>}
 */
async function getRevenueByPeriod(startDate, endDate, period = 'daily') {
  const dateFormats = {
    daily:   '%Y-%m-%d',
    weekly:  '%Y-W%U',   // Week number (00–53, Sunday start)
    monthly: '%Y-%m',
  };

  const dateFormat = dateFormats[period] || dateFormats.daily;

  const pipeline = [
    {
      $match: {
        isPaid: true,
        paidAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: dateFormat, date: '$paidAt', timezone: 'UTC' },
        },
        revenue:    { $sum: '$totalPrice' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } }, // Chronological order
  ];

  return Order.aggregate(pipeline);
}

// ── getTopSellingProducts ─────────────────────────────────────────────────────

/**
 * Top N products by units sold across all paid orders.
 *
 * @param  {number} [limit=10]
 * @returns {Promise<Array<{
 *   productId: ObjectId,
 *   name:      string,
 *   sold:      number,
 *   revenue:   number,
 *   image:     string
 * }>>}
 */
async function getTopSellingProducts(limit = 10) {
  return Order.aggregate([
    { $match: { isPaid: true } },
    { $unwind: '$items' },
    {
      $group: {
        _id:     '$items.product',
        name:    { $first: '$items.name' },
        image:   { $first: '$items.image' },
        sold:    { $sum:   '$items.quantity' },
        revenue: { $sum:   { $multiply: ['$items.price', '$items.quantity'] } },
      },
    },
    { $sort: { sold: -1 } },
    { $limit: limit },
    {
      // Join to get current product details (slug for linking)
      $lookup: {
        from:         'products',
        localField:   '_id',
        foreignField: '_id',
        as:           'productDoc',
      },
    },
    {
      $project: {
        productId: '$_id',
        name:      1,
        image:     1,
        sold:      1,
        revenue:   { $round: ['$revenue', 2] },
        slug:      { $arrayElemAt: ['$productDoc.slug', 0] },
      },
    },
  ]);
}

// ── getUserStats ──────────────────────────────────────────────────────────────

/**
 * User registration and activity statistics.
 *
 * @returns {Promise<{
 *   total:           number,
 *   today:           number,
 *   thisWeek:        number,
 *   thisMonth:       number,
 *   activeLastMonth: number,
 *   byRole:          object
 * }>}
 */
async function getUserStats() {
  const todayStart = startOfDay();
  const weekStart  = startOfWeek();
  const monthStart = startOfMonth();
  const activeFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [stats] = await User.aggregate([
    {
      $facet: {
        total: [{ $count: 'count' }],
        today: [
          { $match: { createdAt: { $gte: todayStart } } },
          { $count: 'count' },
        ],
        thisWeek: [
          { $match: { createdAt: { $gte: weekStart } } },
          { $count: 'count' },
        ],
        thisMonth: [
          { $match: { createdAt: { $gte: monthStart } } },
          { $count: 'count' },
        ],
        activeLastMonth: [
          { $match: { lastLogin: { $gte: activeFrom } } },
          { $count: 'count' },
        ],
        byRole: [
          { $group: { _id: '$role', count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const byRole = {};
  (stats.byRole || []).forEach(({ _id, count }) => {
    byRole[_id] = count;
  });

  return {
    total:           stats.total[0]?.count           || 0,
    today:           stats.today[0]?.count           || 0,
    thisWeek:        stats.thisWeek[0]?.count        || 0,
    thisMonth:       stats.thisMonth[0]?.count       || 0,
    activeLastMonth: stats.activeLastMonth[0]?.count || 0,
    byRole,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getDashboardStats,
  getRevenueByPeriod,
  getTopSellingProducts,
  getUserStats,
};