'use strict';

/**
 * models/RefreshToken.js — Refresh Token Schema & Model
 * ========================================================
 * Stores SHA-256 hashes of refresh tokens — NEVER the raw JWT.
 * TTL index auto-deletes expired documents at the DB level.
 */

const mongoose = require('mongoose');

// ── RefreshTokenSchema ────────────────────────────────────────────────────────

const RefreshTokenSchema = new mongoose.Schema(
  {
    // SHA-256 hash of the raw JWT refresh token
    token: {
      type:     String,
      required: [true, 'Token hash is required.'],
      unique:   true,
    },

    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Token must belong to a user.'],
    },

    expiresAt: {
      type:     Date,
      required: [true, 'Expiry date is required.'],
    },

    isRevoked: {
      type:    Boolean,
      default: false,
    },

    // Audit / device-tracking fields
    userAgent: { type: String, default: '' },
    ip:        { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Fast token lookup (used on every token refresh)
RefreshTokenSchema.index({ token:     1 }, { unique: true });

// Fast revocation of all tokens for a user (password change, deactivation)
RefreshTokenSchema.index({ user:      1 });
RefreshTokenSchema.index({ user:      1, isRevoked: 1 });

// TTL index: MongoDB auto-deletes documents when expiresAt passes.
// expireAfterSeconds: 0 means "delete at exactly expiresAt" — no additional delay.
RefreshTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * Find a valid (not revoked, not expired) refresh token by its hash.
 *
 * @param  {string} tokenHash — SHA-256 hex digest
 * @returns {Promise<Document|null>}
 */
RefreshTokenSchema.statics.findValid = function (tokenHash) {
  return this.findOne({
    token:     tokenHash,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  });
};

/**
 * Revoke a single token by its hash (mark isRevoked = true).
 * Does not delete the document — lets cleanup.job handle that.
 *
 * @param  {string} tokenHash
 * @returns {Promise<object>} result of updateOne
 */
RefreshTokenSchema.statics.revokeToken = function (tokenHash) {
  return this.updateOne({ token: tokenHash }, { $set: { isRevoked: true } });
};

/**
 * Revoke ALL refresh tokens for a user.
 * Called on password change, account deactivation, or admin action.
 *
 * @param  {mongoose.Types.ObjectId|string} userId
 * @returns {Promise<object>} result of updateMany
 */
RefreshTokenSchema.statics.revokeAllForUser = function (userId) {
  return this.updateMany({ user: userId }, { $set: { isRevoked: true } });
};

// ─────────────────────────────────────────────────────────────────────────────

const RefreshToken = mongoose.model('RefreshToken', RefreshTokenSchema);
module.exports = RefreshToken;