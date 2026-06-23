'use strict';

/**
 * middleware/audit.middleware.js — Audit Trail Logging
 * ======================================================
 * Logs sensitive operations after the response is sent.
 * Uses res.on('finish') so it is completely non-blocking — it never
 * delays the response and a logging failure never reaches the client.
 *
 * Usage:
 *   router.post('/login',          auditLog('USER_LOGIN'),       login)
 *   router.post('/logout',         auditLog('USER_LOGOUT'),      logout)
 *   router.patch('/me/password',   auditLog('PASSWORD_CHANGE'),  updatePassword)
 *   router.post('/refund/:id',     auditLog('PAYMENT_REFUND'),   refundPayment)
 *   router.delete('/:id',          auditLog('USER_DELETE'),      deleteUser)
 *   router.patch('/:id',           auditLog('ADMIN_UPDATE_USER'), updateUser)
 */

const logger = require('../utils/logger');

// ── Sensitive fields that must NEVER appear in audit logs ─────────────────────
const REDACTED_BODY_FIELDS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'accessToken',
  'cardNumber',
  'cvv',
  'ssn',
]);

/**
 * Return a sanitised copy of req.body with sensitive fields replaced by '[REDACTED]'.
 * Returns undefined if body is empty or non-object to keep logs lean.
 */
function sanitiseBody(body) {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return undefined;
  }

  const sanitised = {};
  for (const [key, val] of Object.entries(body)) {
    sanitised[key] = REDACTED_BODY_FIELDS.has(key) ? '[REDACTED]' : val;
  }
  return sanitised;
}

// ── auditLog ──────────────────────────────────────────────────────────────────

/**
 * Returns middleware that writes a structured audit entry after the response.
 *
 * @param {string} action — human-readable action label (e.g. 'USER_LOGIN')
 */
const auditLog = (action) => (req, res, next) => {
  res.on('finish', () => {
    try {
      const entry = {
        action,
        userId:     req.user?._id?.toString()  || null,
        userRole:   req.user?.role             || null,
        userEmail:  req.user?.email            || null, // helpful in admin audits
        ip:         req.ip || req.headers['x-forwarded-for'] || 'unknown',
        userAgent:  req.headers['user-agent']  || 'unknown',
        method:     req.method,
        path:       req.originalUrl,
        statusCode: res.statusCode,
        success:    res.statusCode >= 200 && res.statusCode < 400,
        timestamp:  new Date().toISOString(),
        // Include sanitised body for mutating operations to aid investigations
        // Skip for GET — body is always empty
        ...(req.method !== 'GET' && { body: sanitiseBody(req.body) }),
        // Include route params (e.g. which user/order was targeted)
        ...(Object.keys(req.params).length > 0 && { params: req.params }),
      };

      // Write audit to a dedicated logger channel.
      // In production, pipe 'audit' logs to a separate file or SIEM system.
      logger.info('AUDIT', entry);
    } catch (err) {
      // Audit logging must never throw — swallow silently
      logger.warn('Audit log write failed', { action, error: err.message });
    }
  });

  next();
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { auditLog };