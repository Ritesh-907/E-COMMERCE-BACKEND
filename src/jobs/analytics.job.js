'use strict';

/**
 * jobs/analytics.job.js — Analytics Cache Pre-computation
 * ==========================================================
 * Pre-computes expensive analytics aggregations and stores them in Redis
 * so the admin dashboard loads instantly without hitting MongoDB on every
 * page visit.
 *
 * Schedule:
 *   refreshAnalyticsCache — every hour  (0 * * * *)
 *
 * Also runs once immediately at startup so the cache is warm before the
 * first admin visits the dashboard.
 */

const cron             = require('node-cron');
const analyticsService = require('../services/analytics.service');
const cacheService     = require('../services/cache.service');
const logger           = require('../utils/logger');
const { CACHE_TTL }    = require('../utils/constants');

// ── refreshAnalyticsCache ─────────────────────────────────────────────────────

async function refreshAnalyticsCache() {
  const jobName  = 'refreshAnalyticsCache';
  const startedAt = Date.now();

  logger.info(`[${jobName}] Starting`);

  // Track individual task outcomes so a single failure doesn't abort the rest
  const results = {
    dashboard:      false,
    topProducts:    false,
    topCategories:  false,
    userGrowth:     false,
    revenue30d:     false,
  };

  // ── Dashboard stats ─────────────────────────────────────────────────────────

  try {
    const stats = await analyticsService.getDashboardStats();

    await cacheService.set(
      'analytics:dashboard',
      { ...stats, cachedAt: new Date().toISOString() },
      CACHE_TTL.ANALYTICS
    );

    results.dashboard = true;
  } catch (err) {
    logger.error(`[${jobName}] Dashboard stats failed`, { error: err.message });
  }

  // ── Top-selling products (top 10) ──────────────────────────────────────────

  try {
    const topProducts = await analyticsService.getTopSellingProducts(10);

    await cacheService.set(
      'analytics:top-products:10',
      topProducts,
      CACHE_TTL.ANALYTICS
    );

    results.topProducts = true;
  } catch (err) {
    logger.error(`[${jobName}] Top products failed`, { error: err.message });
  }

  // ── Revenue chart — last 30 days, daily granularity ────────────────────────

  try {
    const endDate   = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const revenueData = await analyticsService.getRevenueByPeriod(
      startDate,
      endDate,
      'daily'
    );

    const cacheKey = `analytics:revenue:daily:${startDate.toISOString()}:${endDate.toISOString()}`;

    await cacheService.set(
      cacheKey,
      revenueData,
      CACHE_TTL.ANALYTICS
    );

    results.revenue30d = true;
  } catch (err) {
    logger.error(`[${jobName}] Revenue chart (30d) failed`, { error: err.message });
  }

  // ── User growth stats ───────────────────────────────────────────────────────

  try {
    const userStats = await analyticsService.getUserStats();

    await cacheService.set(
      'analytics:user-growth',
      userStats,
      CACHE_TTL.ANALYTICS
    );

    results.userGrowth = true;
  } catch (err) {
    logger.error(`[${jobName}] User growth stats failed`, { error: err.message });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const elapsed    = Date.now() - startedAt;
  const successful = Object.values(results).filter(Boolean).length;
  const total      = Object.keys(results).length;

  const logFn = successful === total ? logger.info.bind(logger) : logger.warn.bind(logger);

  logFn(`[${jobName}] Completed`, {
    successful,
    total,
    elapsedMs: elapsed,
    results,
  });
}

// ── initAnalyticsJobs ─────────────────────────────────────────────────────────

function initAnalyticsJobs() {
  // Refresh cache every hour
  cron.schedule('0 * * * *', refreshAnalyticsCache, {
    timezone: 'UTC',
  });

  logger.info('Analytics jobs initialized', {
    jobs: ['refreshAnalyticsCache (every hour)'],
  });

  // Run immediately on startup so cache is warm before any admin visit.
  // Use setImmediate so it runs after the current event loop tick — i.e.
  // after server.js has finished setting everything else up.
  setImmediate(() => {
    refreshAnalyticsCache().catch((err) => {
      logger.error('Initial analytics cache warm-up failed', { error: err.message });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  initAnalyticsJobs,
  // Export for tests and a potential admin endpoint: POST /admin/jobs/analytics/refresh
  refreshAnalyticsCache,
};