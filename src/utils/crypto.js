'use strict';

/**
 * utils/crypto.js — Cryptographic Utility Functions
 * ====================================================
 * Secure token generation and hashing for auth flows.
 * All functions use Node's built-in `crypto` module — no third-party deps.
 *
 * Pattern used throughout the app:
 *   1. generateToken()   → send RAW token to user (email link / SMS)
 *   2. hashToken(raw)    → store HASH in DB
 *   3. On verify: hashToken(incoming) → compare to stored hash
 *
 * Passwords are handled separately via bcryptjs in the User model —
 * NEVER use these functions for passwords.
 */

const crypto = require('crypto');

// ── generateToken ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random hex token.
 *
 * @param  {number} [bytes=32] — number of random bytes (hex string is 2× longer)
 * @returns {string}             64-char hex string for 32 bytes
 *
 * @example
 *   const rawToken = generateToken()   // '8f3a9c…' (64 chars)
 *   await emailService.sendResetLink(user, rawToken)
 *   user.passwordResetToken = hashToken(rawToken)
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ── hashToken ─────────────────────────────────────────────────────────────────

/**
 * Hash a raw token with SHA-256 for secure storage.
 * SHA-256 is appropriate here because the token is already high-entropy
 * (32 random bytes) — bcrypt is not needed.
 *
 * @param  {string} rawToken
 * @returns {string} 64-char hex digest
 */
function hashToken(rawToken) {
  return crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');
}

// ── compareHash ───────────────────────────────────────────────────────────────

/**
 * Hash a raw value and compare it to a stored hash.
 * Convenience wrapper for the most common verification pattern.
 *
 * @param  {string} rawValue
 * @param  {string} storedHash
 * @returns {boolean}
 */
function compareHash(rawValue, storedHash) {
  return hashToken(rawValue) === storedHash;
}

// ── generateOTP ───────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure numeric OTP.
 * Uses crypto.randomInt (Node ≥ 14.10) for uniform distribution —
 * Math.random() has statistical bias and must not be used for security codes.
 *
 * @param  {number} [length=6] — number of digits (min 4, max 8)
 * @returns {string}             zero-padded digit string, e.g. '047392'
 */
function generateOTP(length = 6) {
  const safeLength = Math.min(8, Math.max(4, length));
  const min = 10 ** (safeLength - 1);
  const max = 10 **  safeLength;
  return crypto.randomInt(min, max).toString();
}

// ── generateSecureId ──────────────────────────────────────────────────────────

/**
 * Generate a URL-safe base64 random ID.
 * Shorter than a hex token — useful for idempotency keys and short links.
 *
 * @param  {number} [bytes=16] — 16 bytes → 22-char base64url string
 * @returns {string}
 */
function generateSecureId(bytes = 16) {
  return crypto
    .randomBytes(bytes)
    .toString('base64url'); // URL-safe: no +, /, or =
}

// ── timingSafeEqual ───────────────────────────────────────────────────────────

/**
 * Timing-safe string comparison — prevents timing attacks on token checks.
 * Both strings must be the same byte length (hash both sides with hashToken first).
 *
 * @param  {string} a
 * @param  {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // Buffers must be the same length for timingSafeEqual
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generateToken,
  hashToken,
  compareHash,
  generateOTP,
  generateSecureId,
  timingSafeEqual,
};