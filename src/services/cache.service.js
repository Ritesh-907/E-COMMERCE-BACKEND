'use strict';

/**
 * services/cache.service.js — Redis Cache Abstraction
 * =====================================================
 * Thin wrapper around ioredis with graceful degradation.
 * If Redis is unavailable every function degrades silently —
 * the app continues to work, just without caching.
 *
 * Key conventions (ioredis adds 'ec:' prefix automatically):
 *   cache:{route}           → HTTP response cache (cache.middleware.js)
 *   analytics:dashboard     → pre-computed dashboard stats
 *   categories:all          → category flat list
 *   analytics:top-products  → top-selling products
 */

const logger = require('../utils/logger');

// Lazy import — avoids circular deps at startup and allows the module
// to load even before Redis is connected
const getClient = () => {
  try {
    return require('../config/redis').redisClient;
  } catch {
    return null;
  }
};

// ── isReady ───────────────────────────────────────────────────────────────────

function isReady() {
  const client = getClient();
  return client && client.status === 'ready';
}

// ── get ───────────────────────────────────────────────────────────────────────

/**
 * Retrieve a cached value by key.
 * Returns null on cache miss, parse error, or Redis unavailability.
 *
 * @param  {string} key
 * @returns {Promise<any|null>}
 */
async function get(key) {
  if (!isReady()) return null;

  try {
    const raw = await getClient().get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('cache.get failed', { key, error: err.message });
    return null;
  }
}

// ── set ───────────────────────────────────────────────────────────────────────

/**
 * Store a value in the cache with a TTL.
 *
 * @param  {string} key
 * @param  {any}    data
 * @param  {number} ttlSeconds
 * @returns {Promise<void>}
 */
async function set(key, data, ttlSeconds) {
  if (!isReady()) return;

  try {
    await getClient().setex(key, ttlSeconds, JSON.stringify(data));
  } catch (err) {
    logger.warn('cache.set failed', { key, error: err.message });
  }
}

// ── del ───────────────────────────────────────────────────────────────────────

/**
 * Delete a single key from the cache.
 *
 * @param  {string} key
 * @returns {Promise<void>}
 */
async function del(key) {
  if (!isReady()) return;

  try {
    await getClient().del(key);
  } catch (err) {
    logger.warn('cache.del failed', { key, error: err.message });
  }
}

// ── flush ─────────────────────────────────────────────────────────────────────

/**
 * Delete all keys matching a glob pattern.
 * Uses cursor-based SCAN to avoid blocking Redis with KEYS on large datasets.
 *
 * The ioredis keyPrefix ('ec:') is added automatically at write time, but
 * SCAN sees raw keys in Redis — so the prefix must be included in the pattern.
 *
 * @param  {string} pattern — glob, e.g. 'cache:/api/v1/products*'
 * @returns {Promise<void>}
 */
async function flush(pattern) {
  if (!isReady()) return;

  const client     = getClient();
  const rawPattern = `ec:${pattern}`;
  const keys       = [];
  let   cursor     = '0';

  try {
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

    // Delete in one round-trip
    await client.del(keys);

    logger.debug('Cache flushed', { pattern, deleted: keys.length });
  } catch (err) {
    logger.warn('cache.flush failed', { pattern, error: err.message });
  }
}

// ── remember ──────────────────────────────────────────────────────────────────

/**
 * Cache-aside pattern: return cached value if present, otherwise call
 * fetchFn(), cache the result, and return it.
 *
 * If Redis is unavailable, fetchFn() is called directly — no error thrown.
 *
 * @param  {string}   key
 * @param  {number}   ttlSeconds
 * @param  {Function} fetchFn — async () => data
 * @returns {Promise<any>}
 *
 * @example
 *   const cats = await cacheService.remember(
 *     'categories:all',
 *     3600,
 *     () => Category.find({ isActive: true }).lean()
 *   )
 */
async function remember(key, ttlSeconds, fetchFn) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const data = await fetchFn();

  // Fire-and-forget cache write — don't let a Redis failure delay the response
  set(key, data, ttlSeconds).catch(() => {});

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { get, set, del, flush, remember };