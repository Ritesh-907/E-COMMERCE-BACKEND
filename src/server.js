'use strict';

/**
 * server.js — Entry Point
 * ========================
 * PURPOSE: Boot the HTTP server, connect to DB & Redis, initialize
 * Socket.IO, and start background jobs.
 *
 * Deliberately thin — zero business logic lives here.
 * Everything is delegated to the modules it imports.
 *
 * Start-up sequence:
 *  1. Ensure logs/ directory exists
 *  2. Load environment variables
 *  3. Connect MongoDB
 *  4. Connect Redis (non-fatal — app degrades gracefully if Redis is down)
 *  5. Start HTTP server
 *  6. Initialize Socket.IO
 *  7. Start background jobs
 *
 * Shutdown sequence (SIGTERM / SIGINT):
 *  1. Stop accepting new connections (server.close)
 *  2. Disconnect MongoDB
 *  3. Disconnect Redis
 *  4. Exit with code 0
 */

// ── 1. Ensure logs/ directory exists before any logger import ─────────────────
// Winston will throw if the file transport target directory is missing.
const fs = require('fs');
fs.mkdirSync('logs', { recursive: true });

// ── 2. Environment variables ──────────────────────────────────────────────────
require('dotenv').config();

// ── Core modules ──────────────────────────────────────────────────────────────
const http = require('http');

// ── Application ───────────────────────────────────────────────────────────────
const app = require('./app');

// ── Infrastructure ────────────────────────────────────────────────────────────
const { connectDB, mongooseConnection } = require('./config/db');
const { connectRedis, redisClient }     = require('./config/redis');

// ── Real-time ─────────────────────────────────────────────────────────────────
const { initSocket } = require('./sockets/index');

// ── Background jobs ───────────────────────────────────────────────────────────
const { initCleanupJobs }   = require('./jobs/cleanup.job');
const { initInventoryJobs } = require('./jobs/inventory.job');
const { initAnalyticsJobs } = require('./jobs/analytics.job');

// ── Logger ────────────────────────────────────────────────────────────────────
// Import AFTER logs/ directory is guaranteed to exist.
const logger = require('./utils/logger');

// ─────────────────────────────────────────────────────────────────────────────

const PORT     = process.env.PORT     || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create the raw HTTP server so Socket.IO can share the same port as Express.
const server = http.createServer(app);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  // ── 3. MongoDB ──────────────────────────────────────────────────────────────
  // connectDB() exits the process on failure — no point starting the server
  // if there is no database.
  await connectDB();

  // ── 4. Redis ────────────────────────────────────────────────────────────────
  // Redis is used for caching, rate-limit stores, and job queues.
  // The app is designed to degrade gracefully if Redis is unavailable
  // (cache misses, in-memory rate limiting fallback), so we don't exit on
  // Redis failure — we just log a warning.
  try {
    await connectRedis();
  } catch (err) {
    logger.warn('Redis unavailable — running without cache & queue support', {
      error: err.message,
    });
  }

  // ── 5. HTTP server ───────────────────────────────────────────────────────────
  await new Promise((resolve) => {
    server.listen(PORT, resolve);
  });

  logger.info(`Server running`, {
    port:    PORT,
    env:     NODE_ENV,
    pid:     process.pid,
    docs:    NODE_ENV !== 'production' ? `http://localhost:${PORT}/api/v1/docs` : null,
  });

  // ── 6. Socket.IO ─────────────────────────────────────────────────────────────
  // Must be initialized AFTER the server is listening so it can attach to
  // the upgrade event on the same http.Server instance.
  initSocket(server);

  // ── 7. Background jobs ───────────────────────────────────────────────────────
  // Jobs rely on DB + Redis being ready, so they start last.
  // In test mode skip all cron jobs to keep the process clean.
  if (NODE_ENV !== 'test') {
    initCleanupJobs();    // Daily: expired tokens, old notifications, abandoned orders
    initInventoryJobs();  // Daily: low-stock alerts to admins
    initAnalyticsJobs();  // Hourly: pre-compute dashboard stats into Redis
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections; let in-flight requests finish.
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      if (mongooseConnection) {
        await mongooseConnection.close();
        logger.info('MongoDB connection closed');
      }
    } catch (err) {
      logger.error('Error closing MongoDB connection', { error: err.message });
    }

    try {
      if (redisClient && redisClient.status !== 'end') {
        await redisClient.quit();
        logger.info('Redis connection closed');
      }
    } catch (err) {
      logger.error('Error closing Redis connection', { error: err.message });
    }

    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes longer than 10 seconds.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref(); // unref() so the timer doesn't prevent exit on its own
}

// ── Process-level error handlers ─────────────────────────────────────────────

// Synchronous programming errors (e.g. null dereference outside async code).
// Log and exit immediately — the process is in an unknown state.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — process will exit', {
    error:   err.message,
    stack:   err.stack,
  });
  process.exit(1);
});

// Unhandled Promise rejections (missing .catch() or forgotten await).
// Graceful shutdown gives in-flight HTTP requests time to complete.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — initiating graceful shutdown', {
    reason: reason instanceof Error ? reason.message : reason,
    stack:  reason instanceof Error ? reason.stack   : undefined,
  });
  shutdown('unhandledRejection');
});

// Standard Unix termination signal sent by process managers (PM2, Docker, k8s).
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Ctrl+C in terminal (development).
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  // bootstrap() itself threw before the server was listening (e.g. DB refused).
  // uncaughtException won't catch Promise rejections here, so handle explicitly.
  logger.error('Failed to start server', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});