'use strict';

/**
 * config/redis.js — Redis Client
 * ================================
 * Creates a shared ioredis client used for caching, rate-limit stores,
 * and Bull job queues. The client uses lazyConnect so no connection is
 * attempted until connectRedis() is explicitly called in server.js.
 *
 * All keys are namespaced with the prefix 'ec:' to avoid collisions
 * when the Redis instance is shared with other services.
 */

const Redis  = require('ioredis');
const logger = require('../utils/logger');

// ── Client configuration ──────────────────────────────────────────────────────
const redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  // Do NOT connect immediately — wait for connectRedis() call in server.js
  lazyConnect: true,

  // Namespace every key stored by this app: e.g. 'ec:cache:/api/v1/products'
  keyPrefix: 'ec:',

  // Exponential backoff: 50 ms, 100 ms, 150 ms … capped at 2 s
  retryStrategy: (times) => {
    if (times > 10) {
      // Give up after 10 attempts — let the app continue without Redis
      logger.error('Redis retry limit reached — giving up');
      return null; // Returning null stops retrying
    }
    return Math.min(times * 50, 2_000);
  },

  // Maximum retries per individual command before it fails fast
  maxRetriesPerRequest: 3,

  // Connection timeout
  connectTimeout: 10_000,

  // Keep the connection alive
  keepAlive: 10_000,

  // Reconnect on READONLY errors (Redis Sentinel / failover scenarios)
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
    return targetErrors.some((e) => err.message.includes(e));
  },
});

// ── Event listeners ───────────────────────────────────────────────────────────

redisClient.on('connect', () => {
  logger.info('Redis connected');
});

redisClient.on('ready', () => {
  logger.info('Redis ready — accepting commands');
});

redisClient.on('reconnecting', (delay) => {
  logger.warn('Redis reconnecting', { delay });
});

redisClient.on('error', (err) => {
  // Don't crash on Redis errors — just log them.
  // Individual callers should catch errors and degrade gracefully.
  logger.error('Redis error', { error: err.message });
});

redisClient.on('close', () => {
  logger.warn('Redis connection closed');
});

redisClient.on('end', () => {
  logger.warn('Redis connection ended — no more reconnect attempts');
});

// ── connectRedis ──────────────────────────────────────────────────────────────

/**
 * Explicitly establish the Redis connection.
 * Called once in server.js after MongoDB is ready.
 * Non-fatal — server.js catches errors here and logs a warning.
 */
async function connectRedis() {
  await redisClient.connect();
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  connectRedis,
  // Export the singleton so cache.service.js, Bull queues, and rate-limiter
  // store all share the same connection.
  redisClient,
};