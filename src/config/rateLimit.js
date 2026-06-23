'use strict';

/**
 * config/rateLimit.js — Rate Limiting Middleware
 * ================================================
 * Three tiered limiters, each applied at a different scope:
 *
 *  generalLimiter  → all /api routes           (100 req / 15 min)
 *  authLimiter     → /auth/login, /forgot-pass  (10  req / 15 min)
 *  uploadLimiter   → any route with file upload (20  req / 1 hr)
 *
 * In production a Redis store is used so limits are shared across
 * multiple server instances / pods. Falls back to in-memory store
 * if Redis is unavailable (single-instance mode).
 */

const rateLimit = require('express-rate-limit');

// ── Optional Redis store ──────────────────────────────────────────────────────
// Only wired up when REDIS_URL is present to avoid crashing in environments
// where Redis isn't configured (e.g. CI, local dev without Docker).
let RedisStore;
let redisClient;

try {
  const { redisClient: client } = require('./redis');
  const { default: Store }      = require('rate-limit-redis');
  RedisStore  = Store;
  redisClient = client;
} catch {
  // rate-limit-redis not installed or Redis config missing — fall back silently
}

function makeStore(prefix) {
  if (RedisStore && redisClient && redisClient.status === 'ready') {
    return new RedisStore({
      // ioredis uses sendCommand; the store expects this exact signature
      sendCommand: (...args) => redisClient.call(...args),
      prefix:      `rl:${prefix}:`,
    });
  }
  // In-memory fallback (not shared across processes)
  return undefined;
}

// ── Shared options ────────────────────────────────────────────────────────────

const sharedOptions = {
  // Emit standard RateLimit-* headers (RFC draft)
  standardHeaders: true,
  // Disable deprecated X-RateLimit-* headers
  legacyHeaders: false,

  // Rate limit by IP, falling back to a constant key for requests
  // behind a proxy that strips the IP header
  // keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',

  // Skip entirely in test environment so unit/integration tests aren't blocked
  skip: () => process.env.NODE_ENV === 'test',

  // Use the real IP when behind a reverse proxy (nginx, ALB, Cloudflare)
  // Must also set `app.set('trust proxy', 1)` in app.js if behind a proxy
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
};

// ── generalLimiter ────────────────────────────────────────────────────────────
// Applied at /api level in app.js — covers every route.

const generalLimiter = rateLimit({
  ...sharedOptions,
  windowMs:   15 * 60 * 1000, // 15 minutes
  max:        100,
  message:    'Too many requests from this IP, please try again after 15 minutes.',
  store:      makeStore('general'),
});

// ── authLimiter ───────────────────────────────────────────────────────────────
// Applied in auth.routes.js on POST /login and POST /forgot-password.
// Tight cap prevents brute-force credential attacks.

const authLimiter = rateLimit({
  ...sharedOptions,
  windowMs:   15 * 60 * 1000, // 15 minutes
  max:        10,
  message:    'Too many authentication attempts. Please try again in 15 minutes.',
  store:      makeStore('auth'),
});

// ── uploadLimiter ─────────────────────────────────────────────────────────────
// Applied on routes that accept file uploads (product images, avatars).
// Prevents storage-abuse attacks.

const uploadLimiter = rateLimit({
  ...sharedOptions,
  windowMs:   60 * 60 * 1000, // 1 hour
  max:        20,
  message:    'Upload limit reached. You can upload at most 20 files per hour.',
  store:      makeStore('upload'),
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
};