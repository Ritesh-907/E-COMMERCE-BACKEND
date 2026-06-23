'use strict';

/**
 * app.js — Express Application Factory
 * ======================================
 * PURPOSE: Create and configure the Express app instance.
 * Intentionally kept separate from server.js so the app can be
 * imported cleanly in tests without binding to a port.
 *
 * Mount order matters:
 *  1. Security hardening  (helmet, mongoSanitize, xss, hpp)
 *  2. Core parsing        (express.json, express.urlencoded, cookieParser)
 *  3. CORS
 *  4. HTTP request logger (morgan)
 *  5. Passport init
 *  6. Static files
 *  7. API routes          (all under /api/v1)
 *  8. Swagger docs        (dev only)
 *  9. 404 handler
 * 10. Global error handler  ← MUST be last
 */

const express      = require('express');
const cookieParser = require('cookie-parser');
const compression  = require('compression');
const cors         = require('cors');
const passport     = require('passport');
const path         = require('path');

// ── Config & utilities ───────────────────────────────────────────────────────
const corsOptions                 = require('./config/cors');
const { generalLimiter }          = require('./config/rateLimit');
const { initPassport }            = require('./config/passport');

// ── Middleware ────────────────────────────────────────────────────────────────
const { configureSecurityMiddleware } = require('./middleware/security.middleware');
const httpLogger                      = require('./middleware/logger.middleware');
const { notFound }                    = require('./middleware/notFound.middleware');
const { errorHandler }                = require('./middleware/error.middleware');

// ── Routes ────────────────────────────────────────────────────────────────────
const apiRoutes = require('./routes/index');

// ── API Docs ──────────────────────────────────────────────────────────────────
const { setupSwagger } = require('./docs/swagger');

// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// ── 1. Security middleware ────────────────────────────────────────────────────
// Applies: helmet (security headers), mongoSanitize (NoSQL injection),
//          xss (cross-site scripting), hpp (HTTP parameter pollution)
configureSecurityMiddleware(app);

// ── 2. Compression ───────────────────────────────────────────────────────────
// Gzip/Brotli compress responses above 1 KB — reduces bandwidth significantly.
// Skip for already-compressed image types served via Cloudinary/S3.
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
    threshold: 1024, // Only compress responses > 1 KB
  })
);

// ── 3. CORS ───────────────────────────────────────────────────────────────────
// Must come BEFORE cookie-parser and body parsers so preflight OPTIONS
// requests are handled correctly without hitting authentication.
app.use(cors(corsOptions));

// ── 9 or 4. Stripe webhook ─────────────────────────────────────────────────────────
// Stripe requires the raw unparsed body to verify the webhook signature.
// This route is mounted BEFORE express.json so the raw body is intact.
// The actual route handler lives in payment.routes.js.
app.use(
  '/api/v1/payments/webhook',
  express.raw({ type: 'application/json' })
);

// ── 4. Body parsers ───────────────────────────────────────────────────────────
// Limit body size to prevent memory-exhaustion / DOS attacks.
// Webhook routes (e.g. Stripe) need the raw body, so they opt out below.
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── 5. Cookie parser ──────────────────────────────────────────────────────────
// Parses Cookie header into req.cookies. Required for httpOnly refresh tokens.
app.use(cookieParser(process.env.COOKIE_SECRET));

// ── 6. HTTP request logger ───────────────────────────────────────────────────
// Morgan in dev (colorful), combined-format stream to logs/access.log in prod.
// Health-check requests are suppressed to avoid noise.
app.use(httpLogger);

// ── 7. Passport ───────────────────────────────────────────────────────────────
// Registers JWT and Google OAuth strategies. Stateless — no session support.
initPassport(app);

// ── 8. Static files ───────────────────────────────────────────────────────────
// Serve the local uploads directory (avatars, product images before cloud sync).
// In production, all media should go through Cloudinary/S3 — this is a fallback.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    etag: true,
  })
);

// ── 9. Stripe webhook ─────────────────────────────────────────────────────────
// Stripe requires the raw unparsed body to verify the webhook signature.
// This route is mounted BEFORE express.json so the raw body is intact.
// The actual route handler lives in payment.routes.js.
// app.use(
//   '/api/v1/payments/webhook',
//   express.raw({ type: 'application/json' })
// );

// ── 10. Global rate limiter ───────────────────────────────────────────────────
// 100 requests per 15 minutes per IP across all /api routes.
// Tighter authLimiter (10 req / 15 min) is applied inside auth.routes.js.
app.use('/api', generalLimiter);

// ── 11. API routes ────────────────────────────────────────────────────────────
// All routes are prefixed with /api/v1. Versioning keeps future v2 upgrades
// non-breaking.
//
//   GET  /api/v1/health          → uptime health check
//   *    /api/v1/auth            → authentication & OAuth
//   *    /api/v1/users           → user profile management
//   *    /api/v1/products        → product CRUD + search
//   *    /api/v1/categories      → category tree
//   *    /api/v1/orders          → order lifecycle
//   *    /api/v1/cart            → shopping cart
//   *    /api/v1/reviews         → product reviews
//   *    /api/v1/coupons         → discount codes
//   *    /api/v1/payments        → Stripe payments + webhooks
//   *    /api/v1/wishlist        → saved items
//   *    /api/v1/analytics       → admin dashboard metrics
app.use('/api/v1', apiRoutes);

// ── 12. API docs ──────────────────────────────────────────────────────────────
// Swagger UI at /api/v1/docs (development only — never expose in production).
// Also serves the raw OpenAPI spec at /api/v1/docs.json.
setupSwagger(app);

// ── 13. 404 handler ───────────────────────────────────────────────────────────
// Catches any request that didn't match a route above.
// Forwards a formatted AppError(404) to the global error handler.
app.use(notFound);

// ── 14. Global error handler ──────────────────────────────────────────────────
// MUST be the very last middleware registered.
// Handles: Mongoose errors, JWT errors, Multer errors, custom AppErrors.
// Returns consistent { success: false, message, [stack] } JSON shape.
app.use(errorHandler);

module.exports = app;