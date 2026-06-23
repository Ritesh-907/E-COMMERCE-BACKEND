
'use strict';

/**
 * middleware/notFound.middleware.js — 404 Not Found Handler
 * ===========================================================
 * Catches every request that didn't match any registered route and
 * forwards a formatted 404 AppError to the global error handler.
 *
 * Mount in app.js AFTER all routes and BEFORE errorHandler:
 *   app.use(notFound)
 *   app.use(errorHandler)
 */

const AppError = require('../utils/AppError');

// ── notFound ──────────────────────────────────────────────────────────────────

const notFound = (req, res, next) => {
  next(
    new AppError(
      `Cannot ${req.method} ${req.originalUrl} — route not found.`,
      404
    )
  );
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { notFound };