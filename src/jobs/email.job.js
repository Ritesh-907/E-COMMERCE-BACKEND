"use strict";

/**
 * jobs/email.job.js — Async Email Queue (Bull + Redis)
 * ======================================================
 * Creates a Bull queue backed by Redis for all transactional emails.
 * Controllers and event listeners call addEmailJob() and return immediately.
 * The processor handles delivery with automatic retries and exponential backoff.
 *
 * Queue name : email-queue
 * Job name   : sendEmail
 * Retries    : 3 attempts with exponential backoff starting at 2 s
 */

const Bull = require("bull");
const emailService = require("../services/email.service");
const logger = require("../utils/logger");

// ── Queue creation ────────────────────────────────────────────────────────────
console.log("REDIS_URL:", process.env.REDIS_URL);
const redisUrl = new URL(process.env.REDIS_URL);

const emailQueue = new Bull("email-queue", {
  redis: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port),
    password: redisUrl.password,
    tls: {},

    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },

  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
    timeout: 30000,
  },
});
// const emailQueue = new Bull('email-queue', {
//   redis: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

//   defaultJobOptions: {
//     // Retry up to 3 times before marking as failed
//     attempts: 3,

//     // Exponential backoff: 2 s → 4 s → 8 s between attempts
//     backoff: {
//       type:  'exponential',
//       delay: 2_000,
//     },

//     // Remove completed jobs to keep Redis lean
//     removeOnComplete: true,

//     // Keep failed jobs so we can inspect / replay them manually
//     removeOnFail: false,

//     // Timeout a job that hasn't finished in 30 s (e.g. hung SMTP connection)
//     timeout: 30_000,
//   },
// });

// ── Processor ─────────────────────────────────────────────────────────────────
// Processes up to 5 concurrent email jobs to prevent overwhelming the SMTP relay.

emailQueue.process("sendEmail", 5, async (job) => {
  const { type, to, data } = job.data;

  logger.debug("Processing email job", {
    jobId: job.id,
    type,
    to,
    attempt: job.attemptsMade + 1,
  });

  switch (type) {
    case "verification":
      return emailService.sendVerificationEmail(data.user, data.token);

    case "passwordReset":
      return emailService.sendPasswordResetEmail(data.user, data.token);

    case "orderReceived":
      return emailService.sendOrderReceived(data.user, data.order);

    case "orderConfirm":
      return emailService.sendOrderConfirmation(data.user, data.order);

    case "orderStatus":
      return emailService.sendOrderStatusUpdate(data.user, data.order);

    case "welcome":
      return emailService.sendWelcomeEmail(data.user);

    case "lowStock":
      return emailService.sendLowStockAlert(data.adminEmail, data.products);

    // case "newOrderAdmin":
    //   return emailService.sendNewOrderAdminAlert(
    //     data.adminName,
    //     data.order,
    //     data.customer,
    //   );

    // case "newSaleNotification":
    //   return emailService.sendSellerSaleNotification(
    //     data.sellerName,
    //     data.order,
    //     data.customer,
    //     data.soldProducts,
    //   );

    case "securityAlert":
      return emailService.sendSecurityAlertEmail(
        data.user,
        data.action,
        data.note,
      );

    case "accountDeactivated":
      return emailService.sendAccountDeactivatedEmail(data.user);

    default:
      // Unknown type: don't retry — mark as failed immediately
      throw Object.assign(new Error(`Unknown email job type: "${type}"`), {
        noRetry: true,
      });
  }
});

// ── Queue event listeners (monitoring) ───────────────────────────────────────

emailQueue.on("completed", (job) => {
  logger.debug("Email sent successfully", {
    jobId: job.id,
    type: job.data.type,
    to: job.data.to,
  });
});

emailQueue.on("failed", (job, err) => {
  const isFinal = job.attemptsMade >= job.opts.attempts;
  const logFn = isFinal ? logger.error.bind(logger) : logger.warn.bind(logger);

  logFn("Email job failed", {
    jobId: job.id,
    type: job.data.type,
    to: job.data.to,
    attempt: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    error: err.message,
    final: isFinal,
  });
});

emailQueue.on("stalled", (job) => {
  logger.warn("Email job stalled — will be retried", {
    jobId: job.id,
    type: job.data.type,
  });
});

emailQueue.on("error", (err) => {
  // Queue-level error (e.g. Redis connection lost)
  logger.error("Email queue error", { error: err.message });
});

emailQueue.on("waiting", (jobId) => {
  logger.debug("Email job waiting", { jobId });
});

// ── addEmailJob ───────────────────────────────────────────────────────────────

/**
 * Enqueue a transactional email.
 *
 * @param {string} type    — email type key (matches switch cases above)
 * @param {string} to      — recipient email address (stored for logging only)
 * @param {object} data    — payload passed to the relevant emailService method
 * @param {object} [opts]  — override Bull job options per call
 * @returns {Promise<Bull.Job>}
 *
 * @example
 *   await addEmailJob('orderConfirm', user.email, { user, order });
 *   await addEmailJob('lowStock', admin.email, { adminEmail: admin.email, products });
 */
async function addEmailJob(type, to, data, opts = {}) {
  try {
    const job = await emailQueue.add("sendEmail", { type, to, data }, opts);

    logger.debug("Email job enqueued", { jobId: job.id, type, to });
    return job;
  } catch (err) {
    // If Redis is down, log and swallow — don't let email queueing crash a request
    logger.error("Failed to enqueue email job", {
      type,
      to,
      error: err.message,
    });
    return null;
  }
}

// ── initEmailJob ──────────────────────────────────────────────────────────────
// Called once from server.js if you need explicit initialisation logging.
// The queue and processor are ready from module load — this is optional.

function initEmailJob() {
  logger.info("Email job queue initialized", {
    queue: "email-queue",
    redis: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  emailQueue,
  addEmailJob,
  initEmailJob,
};
