'use strict';

/**
 * events/user.events.js — User Domain Event Emitter
 * ===================================================
 * Decouples user lifecycle side-effects (emails, audit logs,
 * welcome notifications) from controllers.
 *
 * Events:
 *   user.registered      — new account created
 *   user.verified        — email address verified
 *   user.loggedIn        — successful login (audit)
 *   user.passwordChanged — password updated or reset
 *   user.deactivated     — account soft-deleted
 */

const { EventEmitter } = require('events');

const logger = require('../utils/logger');
const { NOTIFICATION_TYPE } = require('../utils/enums');

// ── Lazy imports ──────────────────────────────────────────────────────────────

const getNotificationService = () => require('../services/notification.service');
const getAddEmailJob         = () => require('../jobs/email.job').addEmailJob;

// ── Emitter instance ──────────────────────────────────────────────────────────

const userEmitter = new EventEmitter();
userEmitter.setMaxListeners(20);

// ── user.registered ───────────────────────────────────────────────────────────
// Fired by: auth.controller.js → register
// Payload: { user, verifyToken }
// NOTE: verifyToken is the RAW (un-hashed) token — needed to build the email link.

userEmitter.on('user.registered', async ({ user, verifyToken }) => {
  try {
    // Queue verification email. If the job fails, Bull retries up to 3 times.
    await getAddEmailJob()('verification', user.email, { user, token: verifyToken });

    logger.info('user.registered: verification email queued', {
      userId: user._id,
      email:  user.email,
    });
  } catch (err) {
    logger.error('user.registered: email job failed', {
      userId: user._id,
      error:  err.message,
    });
  }
});

// ── user.verified ─────────────────────────────────────────────────────────────
// Fired by: auth.controller.js → verifyEmail
// Payload: { user }

userEmitter.on('user.verified', async ({ user }) => {
  // 1. Queue welcome email
  try {
    await getAddEmailJob()('welcome', user.email, { user });

    logger.info('user.verified: welcome email queued', {
      userId: user._id,
    });
  } catch (err) {
    logger.error('user.verified: email job failed', {
      userId: user._id,
      error:  err.message,
    });
  }

  // 2. In-app welcome notification
  try {
    await getNotificationService().createNotification({
      userId:  user._id,
      type:    NOTIFICATION_TYPE.SYSTEM,
      title:   '👋 Welcome to the Store!',
      message: `Hi ${user.name || user.firstName || 'there'}! Your account is verified. Start shopping now.`,
      link:    '/products',
    });
  } catch (err) {
    logger.error('user.verified: notification failed', {
      userId: user._id,
      error:  err.message,
    });
  }
});

// ── user.loggedIn ─────────────────────────────────────────────────────────────
// Fired by: auth.controller.js → login
// Payload: { user, ip, userAgent }
// Used for audit logging — does NOT send emails (that would be annoying).

userEmitter.on('user.loggedIn', async ({ user, ip, userAgent }) => {
  // Structured audit log — picked up by log aggregators (Datadog, CloudWatch, etc.)
  logger.info('AUDIT: user login', {
    userId:    user._id,
    email:     user.email,
    role:      user.role,
    ip,
    userAgent,
    timestamp: new Date().toISOString(),
  });

  // Optional: if the login IP looks unusual (geo-mismatch), send a security alert.
  // This is a placeholder — implement full IP-geo checks if needed.
  // try {
  //   const isSuspicious = await detectSuspiciousLogin(user._id, ip);
  //   if (isSuspicious) {
  //     await getAddEmailJob()('securityAlert', user.email, {
  //       user, action: 'Login from new location', ip
  //     });
  //   }
  // } catch (err) { logger.error('user.loggedIn: security check failed', { err }); }
});

// ── user.passwordChanged ──────────────────────────────────────────────────────
// Fired by: auth.controller.js → resetPassword, user.controller.js → updatePassword
// Payload: { user }

userEmitter.on('user.passwordChanged', async ({ user }) => {
  // Audit log
  logger.info('AUDIT: password changed', {
    userId:    user._id,
    email:     user.email,
    timestamp: new Date().toISOString(),
  });

  // Security alert email so the user knows about the change
  try {
    await getAddEmailJob()('securityAlert', user.email, {
      user,
      action: 'Your password was changed',
      note:   'If you did not make this change, please contact support immediately.',
    });
  } catch (err) {
    logger.error('user.passwordChanged: security email job failed', {
      userId: user._id,
      error:  err.message,
    });
  }

  // In-app notification
  try {
    await getNotificationService().createNotification({
      userId:  user._id,
      type:    NOTIFICATION_TYPE.SYSTEM,
      title:   'Password Changed',
      message: 'Your account password was recently changed. If this wasn\'t you, contact support.',
      link:    '/account/security',
    });
  } catch (err) {
    logger.error('user.passwordChanged: notification failed', {
      userId: user._id,
      error:  err.message,
    });
  }
});

// ── user.deactivated ──────────────────────────────────────────────────────────
// Fired by: user.controller.js → deleteMe
// Payload: { user }

userEmitter.on('user.deactivated', async ({ user }) => {
  logger.info('AUDIT: account deactivated', {
    userId:    user._id,
    email:     user.email,
    timestamp: new Date().toISOString(),
  });

  // Send a goodbye / data-retention info email (GDPR good practice)
  try {
    await getAddEmailJob()('accountDeactivated', user.email, { user });
  } catch (err) {
    logger.error('user.deactivated: goodbye email job failed', {
      userId: user._id,
      error:  err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = userEmitter;