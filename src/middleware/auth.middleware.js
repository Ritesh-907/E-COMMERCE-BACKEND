'use strict';

/**
 * middleware/auth.middleware.js — JWT Authentication
 * ====================================================
 * Verifies the access token on protected routes and attaches req.user.
 *
 * Exports:
 *   protect      — rejects unauthenticated requests
 *   optionalAuth — attaches user if token present; allows through if not
 */

const User      = require('../models/User');
const AppError  = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../config/jwt');

// Fields that are never needed downstream from req.user
const EXCLUDED_FIELDS = '-password -emailVerifyToken -emailVerifyExpire -passwordResetToken -passwordResetExpire -__v';

// ── Token extractor ────────────────────────────────────────────────────────────

/**
 * Extract the raw JWT from:
 *   1. Authorization: Bearer <token>  (API clients, Postman, mobile apps)
 *   2. req.cookies.accessToken        (browser-based SPAs with cookie fallback)
 *
 * Returns the token string or null.
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7); // Remove "Bearer " prefix
  }

  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
}

// ── protect ────────────────────────────────────────────────────────────────────

/**
 * Requires a valid access token.
 * Attaches the full user document to req.user.
 * Rejects with 401 if token is missing, invalid, expired, or the user is deactivated.
 */
exports.protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return next(new AppError('Authentication required. Please log in to continue.', 401));
  }

  // verifyAccessToken throws AppError(401) for invalid/expired tokens
  const decoded = verifyAccessToken(token);

  // Re-fetch user on every request to catch:
  //   - deleted accounts
  //   - deactivated accounts
  //   - password changed after token was issued
  const user = await User.findById(decoded.id).select(EXCLUDED_FIELDS);

  if (!user) {
    return next(new AppError('The user belonging to this token no longer exists.', 401));
  }

  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 403));
  }

  // Invalidate tokens issued before the last password change.
  // passwordChangedAt is set by the User model's pre-save hook when password is modified.
  if (user.passwordChangedAt) {
    const changedAt    = Math.floor(user.passwordChangedAt.getTime() / 1000);
    const tokenIssuedAt = decoded.iat;

    if (changedAt > tokenIssuedAt) {
      return next(
        new AppError('Your password was recently changed. Please log in again.', 401)
      );
    }
  }

  // Attach full user document — controllers can read any field without another DB hit
  req.user = user;
  next();
});

// ── optionalAuth ───────────────────────────────────────────────────────────────

/**
 * Attaches req.user if a valid token is present.
 * Allows the request through even if no token is provided or verification fails.
 *
 * Use on public endpoints that behave differently for authenticated users:
 *   - GET /products     (show 'in wishlist' flag for logged-in users)
 *   - GET /reviews      (show 'edit' button for review author)
 */
exports.optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) return next(); // No token — continue as anonymous

  try {
    const decoded = verifyAccessToken(token);
    const user    = await User.findById(decoded.id).select(EXCLUDED_FIELDS);

    if (user && user.isActive) {
      req.user = user;
    }
  } catch {
    // Invalid/expired token on an optional route — silently ignore
    // Don't block the request; just don't set req.user
  }

  next();
}); 