'use strict';

/**
 * middleware/logger.middleware.js — HTTP Request Logger (Morgan)
 * ===============================================================
 * Development : colorised morgan 'dev' format to console
 * Production  : Apache 'combined' format streamed to logs/access.log
 *
 * Health-check requests (/health) are suppressed to keep logs clean.
 */

const fs      = require('fs');
const path    = require('path');
const morgan  = require('morgan');
const logger  = require('../utils/logger');

// ── Custom tokens ─────────────────────────────────────────────────────────────

// Attach authenticated user ID to every log line where available.
// Never log the token itself.
morgan.token('user-id', (req) => req.user?._id?.toString() || 'anon');

// Response time with 2 decimal places (ms)
morgan.token('response-ms', (req, res) => {
  const time = res.get('X-Response-Time');
  return time ? `${time}ms` : '-';
});

// ── Skip function ──────────────────────────────────────────────────────────────
// Suppress:
//   - Health check requests (noisy in load-balanced environments)
//   - Static file requests served from /uploads
//   - Swagger asset requests in development

function skip(req) {
  const url = req.originalUrl || req.url;
  return (
    url === '/health' ||
    url.startsWith('/uploads/') ||
    url.startsWith('/api/v1/docs/') ||
    url === '/favicon.ico'
  );
}

// ── Development logger ────────────────────────────────────────────────────────

const devLogger = morgan('dev', { skip });

// ── Production logger ─────────────────────────────────────────────────────────
// Append to logs/access.log — rotated separately (e.g. logrotate / cron).
// logs/ directory is created in server.js before any imports run.

const accessLogPath   = path.join(__dirname, '../../logs/access.log');
const accessLogStream = fs.createWriteStream(accessLogPath, { flags: 'a' });

// Custom format:  timestamp  method  url  status  bytes  response-time  user
const PROD_FORMAT =
  ':remote-addr - :user-id [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms';

const prodLogger = morgan(PROD_FORMAT, {
  stream: accessLogStream,
  skip,
});

// ── Winston stream for production (dual output) ───────────────────────────────
// In addition to the access log file, forward 5xx responses to Winston
// so they appear in the combined.log alongside application errors.

const winstonStream = {
  write: (message) => {
    // Morgan appends a newline — trim it before passing to Winston
    const trimmed = message.trimEnd();
    // Only forward 5xx lines (they contain ' 5' before the status digit)
    if (/ [5]\d\d /.test(trimmed)) {
      logger.error(`[HTTP] ${trimmed}`);
    }
  },
};

const winstonErrorLogger = morgan(PROD_FORMAT, {
  stream: winstonStream,
  skip: (req, res) => skip(req) || res.statusCode < 500,
});

// ── Export ─────────────────────────────────────────────────────────────────────
// app.js uses this as a single middleware. In production both the file logger
// and the Winston 5xx forwarder run together.

if (process.env.NODE_ENV === 'production') {
  // Use an array-style dispatcher: run both morgan instances sequentially
  module.exports = (req, res, next) => {
    prodLogger(req, res, (err) => {
      if (err) return next(err);
      winstonErrorLogger(req, res, next);
    });
  };
} else {
  module.exports = devLogger;
}