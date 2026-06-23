'use strict';

/**
 * middleware/authorize.middleware.js — Role-Based Access Control (RBAC)
 * =======================================================================
 * Restricts access to routes based on the authenticated user's role.
 * Must always be chained AFTER protect middleware.
 *
 * Usage:
 *   router.delete('/:id', protect, authorize('admin'), deleteUser)
 *   router.post('/',       protect, authorize('admin', 'seller'), createProduct)
 */

const AppError = require('../utils/AppError');
const { USER_ROLES } = require('../utils/enums');

// ── authorize ─────────────────────────────────────────────────────────────────

/**
 * Higher-order middleware factory.
 *
 * @param  {...string} roles — one or more roles that are permitted
 * @returns {Function}        Express middleware
 */
const authorize = (...roles) => (req, res, next) => {
  // Guard: protect middleware must run first
  if (!req.user) {
    return next(
      new AppError('Authentication required. Please log in to continue.', 401)
    );
  }

  // Validate that all supplied roles actually exist in the enum
  // (catches typos in route definitions during development)
  const validRoles = Object.values(USER_ROLES);
  const unknownRoles = roles.filter((r) => !validRoles.includes(r));
  if (unknownRoles.length > 0 && process.env.NODE_ENV === 'development') {
    // Throw a hard error in dev — this is a programmer mistake, not a client error
    throw new Error(
      `authorize() called with unknown role(s): ${unknownRoles.join(', ')}. ` +
      `Valid roles are: ${validRoles.join(', ')}.`
    );
  }

  if (!roles.includes(req.user.role)) {
    // Deliberately vague message — don't tell the client which roles ARE allowed
    return next(
      new AppError(
        `You do not have permission to perform this action.`,
        403
      )
    );
  }

  next();
};

// ── Convenience shortcuts ─────────────────────────────────────────────────────
// These avoid repetitive authorize('admin') calls throughout route files.

/** Permits only admin users */
const adminOnly = authorize(USER_ROLES.ADMIN);

/** Permits admin and seller users */
const adminOrSeller = authorize(USER_ROLES.ADMIN, USER_ROLES.SELLER);

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { authorize, adminOnly, adminOrSeller };