'use strict';

/**
 * middleware/cache.middleware.js — Redis Response Caching
 * =========================================================
 * Caches GET responses in Redis. Intercepts res.json to store the
 * response body after the first successful request, then serves it
 * directly from Redis on subsequent requests.
 *
 * Degrades gracefully — if Redis is unavailable every request falls
 * through to the database with no error thrown.
 *
 * Exports:
 *   cache(ttlSeconds)         — route-level cache middleware
 *   invalidateCache(pattern)  — bust keys matching a pattern (for mutations)
 */

const logger = require('../utils/logger');

// Lazy import to avoid circular dep at startup
const getRedisClient = () => require('../config/redis').redisClient;

// ── cache ─────────────────────────────────────────────────────────────────────

/**
 * Cache a GET response in Redis.
 *
 * Key format: `cache:{originalUrl}` — includes query string so
 *   /products?page=1 and /products?page=2 are stored independently.
 *
 * @param {number} ttlSeconds — how long to keep the cached response
 */
const cache = (ttlSeconds) => async (req, res, next) => {
  // Only cache GET requests — mutations must never be cached
  if (req.method !== 'GET') return next();

  const client = getRedisClient();

  // Degrade gracefully if Redis is not ready
  if (!client || client.status !== 'ready') return next();

  const key = `cache:${req.originalUrl}`;

  try {
    const cached = await client.get(key);

    if (cached) {
      // Cache HIT — respond immediately without touching MongoDB
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(JSON.parse(cached));
    }

    // Cache MISS — intercept res.json to store the response
    res.setHeader('X-Cache', 'MISS');

    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Only cache successful (2xx) responses — don't cache 404s or errors
      if (res.statusCode >= 200 && res.statusCode < 300) {
        client
          .setex(key, ttlSeconds, JSON.stringify(body))
          .catch((err) => {
            logger.warn('Cache set failed', { key, error: err.message });
          });
      }

      // Restore original res.json and send the response normally
      res.json = originalJson;
      return originalJson(body);
    };

    next();
  } catch (err) {
    // Redis error — skip cache entirely, don't block the request
    logger.warn('Cache middleware error — skipping cache', {
      key,
      error: err.message,
    });
    next();
  }
};

// ── invalidateCache ────────────────────────────────────────────────────────────

/**
 * Delete all Redis keys matching a glob pattern.
 * Uses SCAN (cursor-based) to avoid blocking the server with KEYS on large datasets.
 *
 * @param {string} pattern — glob pattern, e.g. 'cache:/api/v1/products*'
 */
async function invalidateCache(pattern) {
  const client = getRedisClient();

  if (!client || client.status !== 'ready') return;

  try {
    const keys      = [];
    let   cursor    = '0';
    // The client adds the 'ec:' keyPrefix automatically, but SCAN sees the
    // raw keys in Redis, so we must include the prefix in the pattern.
    const rawPattern = `ec:${pattern}`;

    do {
      const [nextCursor, batch] = await client.scan(
        cursor,
        'MATCH', rawPattern,
        'COUNT', 100
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) return;

    // Delete in one round-trip using the raw keys (already prefixed)
    // ioredis.del accepts an array
    await client.del(keys);

    logger.debug('Cache invalidated', { pattern, deleted: keys.length });
  } catch (err) {
    logger.warn('Cache invalidation failed', { pattern, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { cache, invalidateCache };