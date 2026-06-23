'use strict';

/**
 * utils/logger.js — Winston Application Logger
 * ===============================================
 * Structured JSON logging with three transports:
 *
 *   Development : colorised, simple format → console only
 *   Production  : JSON format → logs/error.log (errors only)
 *                             → logs/combined.log (all levels)
 *                             → console suppressed (not useful in containers)
 *
 * logs/ directory must exist before this module loads.
 * server.js calls fs.mkdirSync('logs', { recursive: true }) before any imports.
 *
 * Usage:
 *   logger.info('Server started', { port: 5000 })
 *   logger.warn('Redis unavailable')
 *   logger.error('DB failed', { error: err.message, stack: err.stack })
 *   logger.debug('Query', { collection: 'products', ms: 12 })
 */

const { createLogger, format, transports } = require('winston');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf, splat } = format;

// ── Log level ─────────────────────────────────────────────────────────────────
// debug in development (verbose), info in production (structured)

const LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

// ── Formats ───────────────────────────────────────────────────────────────────

// Shared base: timestamp + stack trace on errors
const baseFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),   // Includes err.stack when an Error object is logged
  splat(),                   // Allows printf-style %s interpolation
  json()
);
// Add near the top of logger.js
function safeStringify(obj, indent = 2) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  }, indent);
}
// Development console: colourised, human-readable single line
const devConsoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? '\n  ' + safeStringify(meta).replace(/\n/g, '\n  ')
      : '';
    return `${ts} [${level}]: ${stack || message}${metaStr}`;
  })
);

// ── Transports ────────────────────────────────────────────────────────────────

const logTransports = [];

if (process.env.NODE_ENV !== 'production') {
  // Development: everything to console in colourised format
  logTransports.push(
    new transports.Console({ format: devConsoleFormat })
  );
} else {
  // Production: JSON to rotating files

  // errors only → logs/error.log
  logTransports.push(
    new transports.File({
      filename:    path.join('logs', 'error.log'),
      level:       'error',
      format:      baseFormat,
      maxsize:     10 * 1024 * 1024, // 10 MB per file
      maxFiles:    5,
      tailable:    true,
    })
  );

  // all levels → logs/combined.log
  logTransports.push(
    new transports.File({
      filename:    path.join('logs', 'combined.log'),
      format:      baseFormat,
      maxsize:     20 * 1024 * 1024, // 20 MB per file
      maxFiles:    10,
      tailable:    true,
    })
  );

  // Also log to console in production for container log aggregators
  // (Docker, k8s log forwarders expect stdout/stderr)
  logTransports.push(
    new transports.Console({
      format: baseFormat,
      // Only warn+ to console in production — info/debug go to files only
      level: 'warn',
    })
  );
}

// ── Logger instance ───────────────────────────────────────────────────────────

const logger = createLogger({
  level:       LOG_LEVEL,
  defaultMeta: { service: 'ecommerce-api' },
  transports:  logTransports,

  // Prevent Winston from crashing the process on uncaught logger errors
  exitOnError: false,
});

// ── Silent mode for tests ─────────────────────────────────────────────────────
// Suppresses all log output during jest runs to keep test output clean.
// Set LOG_LEVEL=debug in .env.test to re-enable when debugging tests.

if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_LOGS) {
  logger.silent = true;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = logger;