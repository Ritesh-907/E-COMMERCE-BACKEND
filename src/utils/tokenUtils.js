'use strict';

/**
 * utils/tokenUtils.js — Token Utility Re-Exports
 * =================================================
 * Provides a single import point for all token-related operations.
 * JWT logic lives in config/jwt.js (where secrets are loaded).
 * Crypto logic lives in utils/crypto.js.
 *
 * This module re-exports both so callers that need both sets of functions
 * can import from one place:
 *
 *   const {
 *     generateAccessToken,
 *     generateRefreshToken,
 *     verifyAccessToken,
 *     verifyRefreshToken,
 *     generateRandomToken,
 *     hashToken,
 *   } = require('../utils/tokenUtils')
 *
 * Keeping the implementations in their canonical files avoids circular deps:
 *   - config/jwt.js has no upstream app deps
 *   - utils/crypto.js has no upstream app deps
 */

const {
  signAccessToken:    generateAccessToken,
  signRefreshToken:   generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
} = require('../config/jwt');

const {
  generateToken:  generateRandomToken,
  hashToken,
  compareHash,
  generateOTP,
  generateSecureId,
  timingSafeEqual,
} = require('./crypto');

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // JWT
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,

  // Crypto
  generateRandomToken,
  hashToken,
  compareHash,
  generateOTP,
  generateSecureId,
  timingSafeEqual,
};