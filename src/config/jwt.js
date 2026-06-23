'use strict';

/**
 * config/jwt.js — JWT Configuration & Helpers
 * ==============================================
 * Centralises all JWT sign / verify logic so the rest of the codebase
 * never imports jsonwebtoken directly.
 *
 * Two token types:
 *  - Access token  : short-lived (default 15 m), sent in Authorization header
 *  - Refresh token : long-lived  (default 7 d),  stored in httpOnly cookie
 *                    AND hashed in the RefreshToken collection
 */

const jwt      = require('jsonwebtoken');
const AppError = require('../utils/AppError');

// ── Config ────────────────────────────────────────────────────────────────────

const jwtConfig = {
  accessSecret:  process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  accessExpire:  process.env.JWT_EXPIRE         || '15m',
  refreshExpire: process.env.JWT_REFRESH_EXPIRE || '7d',
  issuer:        'ecommerce-api',
  audience:      'ecommerce-users',
};

// Fail fast at startup if secrets are missing
if (!jwtConfig.accessSecret || !jwtConfig.refreshSecret) {
  throw new Error(
    'JWT_SECRET and JWT_REFRESH_SECRET must be defined in environment variables'
  );
}

// ── Sign helpers ──────────────────────────────────────────────────────────────

/**
 * Sign a short-lived access token.
 * @param  {{ id: string, role: string }} payload  — minimal claims only
 * @returns {string} signed JWT
 */
function signAccessToken(payload) {
  return jwt.sign(payload, jwtConfig.accessSecret, {
    expiresIn: jwtConfig.accessExpire,
    issuer:    jwtConfig.issuer,
    audience:  jwtConfig.audience,
  });
}

/**
 * Sign a long-lived refresh token.
 * @param  {{ id: string }} payload
 * @returns {string} signed JWT
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, jwtConfig.refreshSecret, {
    expiresIn: jwtConfig.refreshExpire,
    issuer:    jwtConfig.issuer,
    audience:  jwtConfig.audience,
  });
}

// ── Verify helpers ────────────────────────────────────────────────────────────

/**
 * Verify and decode an access token.
 * Throws AppError(401) on any failure so callers don't need to
 * handle raw jwt errors.
 *
 * @param  {string} token
 * @returns {object} decoded payload
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, jwtConfig.accessSecret, {
      issuer:   jwtConfig.issuer,
      audience: jwtConfig.audience,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired. Please refresh your session.', 401);
    }
    throw new AppError('Invalid access token.', 401);
  }
}

/**
 * Verify and decode a refresh token.
 * Throws AppError(401) on any failure.
 *
 * @param  {string} token
 * @returns {object} decoded payload
 */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, jwtConfig.refreshSecret, {
      issuer:   jwtConfig.issuer,
      audience: jwtConfig.audience,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Refresh token expired. Please log in again.', 401);
    }
    throw new AppError('Invalid refresh token.', 401);
  }
}

/**
 * Decode a token WITHOUT verifying the signature.
 * Useful for reading the expiry before deciding whether to refresh.
 * Never use the result of this function to authenticate a user.
 *
 * @param  {string} token
 * @returns {object|null} decoded payload or null
 */
function decodeToken(token) {
  return jwt.decode(token);
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  jwtConfig,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
};