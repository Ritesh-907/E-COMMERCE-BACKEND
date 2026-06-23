'use strict';

/**
 * services/auth.service.js — Authentication Business Logic
 * ===========================================================
 * Handles refresh token lifecycle:
 *   generate → rotate → revoke → revoke-all
 *
 * Raw JWT refresh tokens are NEVER stored in the DB.
 * Only their SHA-256 hash is persisted.
 */

const RefreshToken  = require('../models/RefreshToken');
const AppError      = require('../utils/AppError');
const { hashToken } = require('../utils/tokenUtils');
const {
  signAccessToken,
  signRefreshToken,
} = require('../config/jwt');
const logger = require('../utils/logger');

// Refresh token lifetime — must match jwtConfig.refreshExpire in config/jwt.js
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── generateTokenPair ─────────────────────────────────────────────────────────

/**
 * Sign a new access + refresh token pair and persist the hashed refresh token.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} [userAgent='']
 * @param {string} [ip='']
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 *           accessToken  — short-lived JWT (sent in response body)
 *           refreshToken — long-lived JWT  (stored in httpOnly cookie)
 */
async function generateTokenPair(userId, userAgent = '', ip = '') {
  const accessToken  = signAccessToken({ id: userId.toString() });
  const refreshToken = signRefreshToken({ id: userId.toString() });

  // Store the HASH — raw token never touches the DB
  const hashedToken = hashToken(refreshToken);

  await RefreshToken.create({
    token:     hashedToken,
    user:      userId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    userAgent: userAgent || '',
    ip:        ip        || '',
  });

  logger.debug('Token pair generated', { userId });

  return { accessToken, refreshToken };
}

// ── verifyAndGetRefreshToken ──────────────────────────────────────────────────

/**
 * Verify a raw refresh token against the DB.
 * Throws AppError(401) if not found, revoked, or expired.
 *
 * @param {string} rawToken
 * @returns {Promise<RefreshToken document>}
 */
async function verifyAndGetRefreshToken(rawToken) {
  const hashedToken = hashToken(rawToken);

  const tokenDoc = await RefreshToken.findValid(hashedToken);

  if (!tokenDoc) {
    throw new AppError(
      'Invalid or expired refresh token. Please log in again.',
      401
    );
  }

  return tokenDoc;
}

// ── rotateRefreshToken ────────────────────────────────────────────────────────

/**
 * Revoke the old refresh token and issue a fresh pair.
 * Must be called on every /refresh-token request (rotation strategy).
 *
 * @param {string} rawOldToken
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} [userAgent='']
 * @param {string} [ip='']
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
async function rotateRefreshToken(rawOldToken, userId, userAgent = '', ip = '') {
  // Revoke old token
  const hashedOld = hashToken(rawOldToken);
  await RefreshToken.revokeToken(hashedOld);

  // Issue new pair
  const tokens = await generateTokenPair(userId, userAgent, ip);

  logger.debug('Refresh token rotated', { userId });

  return tokens;
}

// ── revokeToken ───────────────────────────────────────────────────────────────

/**
 * Revoke a single refresh token (logout).
 * Non-fatal if the token isn't found (already expired / cleaned up).
 *
 * @param {string} rawToken
 * @returns {Promise<void>}
 */
async function revokeToken(rawToken) {
  try {
    const hashedToken = hashToken(rawToken);
    await RefreshToken.revokeToken(hashedToken);
  } catch (err) {
    logger.warn('revokeToken: failed to revoke token', { error: err.message });
  }
}

// ── revokeAllUserTokens ───────────────────────────────────────────────────────

/**
 * Revoke ALL refresh tokens for a user.
 * Called on:
 *   - password change
 *   - account deactivation (admin action)
 *   - security breach
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<void>}
 */
async function revokeAllUserTokens(userId) {
  await RefreshToken.revokeAllForUser(userId);
  logger.info('All refresh tokens revoked', { userId });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generateTokenPair,
  verifyAndGetRefreshToken,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
};