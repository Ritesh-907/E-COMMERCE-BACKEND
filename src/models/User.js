'use strict';

/**
 * models/User.js — User Schema & Model
 * =======================================
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const { BCRYPT_SALT_ROUNDS, PASSWORD_RESET_EXPIRE, EMAIL_VERIFY_EXPIRE } = require('../utils/constants');
const { USER_ROLES } = require('../utils/enums');

// ── AddressSchema ─────────────────────────────────────────────────────────────

const AddressSchema = new mongoose.Schema(
  {
    street:    { type: String, trim: true, required: true },
    city:      { type: String, trim: true, required: true },
    state:     { type: String, trim: true, required: true },
    zip:       { type: String, trim: true, required: true },
    country:   { type: String, trim: true, required: true },
    phone:     { type: String, trim: true },
    label:     { type: String, enum: ['Home', 'Office', 'Other'], default: 'Home' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true } // Keep _id so addresses can be targeted by req.params.addressId
);

// ── UserSchema ────────────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, 'Name is required.'],
      trim:      true,
      minlength: [2,  'Name must be at least 2 characters.'],
      maxlength: [50, 'Name must not exceed 50 characters.'],
    },

    email: {
      type:      String,
      required:  [true, 'Email is required.'],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.'],
    },

    password: {
      type:      String,
      minlength: [8, 'Password must be at least 8 characters.'],
      select:    false, // Never returned in queries by default
    },

    role: {
      type:    String,
      enum:    Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },

    avatar: {
      url:       { type: String, default: '' },
      public_id: { type: String, default: null },
    },

    phone: {
      type: String,
      trim: true,
    },

    addresses: [AddressSchema],

    // OAuth — set when user signs in with Google
    googleId: {
      type:   String,
      sparse: true, // Allows multiple null values but unique among non-null
    },

    isVerified: { type: Boolean, default: false },
    isActive:   { type: Boolean, default: true  },

    // Email verification (select: false — never exposed in API responses)
    emailVerifyToken:  { type: String, select: false },
    emailVerifyExpire: { type: Date,   select: false },

    // Password reset (select: false)
    passwordResetToken:  { type: String, select: false },
    passwordResetExpire: { type: Date,   select: false },

    // Timestamp of last password change — used to invalidate tokens issued before this
    passwordChangedAt: { type: Date, select: false },

    lastLogin: { type: Date },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

UserSchema.index({ email:    1 });
UserSchema.index({ googleId: 1 }, { sparse: true });
UserSchema.index({ role:     1, isActive: 1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────

UserSchema.virtual('defaultAddress').get(function () {
  return this.addresses?.find((a) => a.isDefault) || this.addresses?.[0] || null;
});

// ── Pre-save hook: hash password ──────────────────────────────────────────────

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (!this.password)               return next(); // OAuth users have no password

  this.password = await bcrypt.hash(this.password, BCRYPT_SALT_ROUNDS);

  // Record when the password was last changed so JWT middleware can
  // invalidate tokens issued before this timestamp
  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000; // -1 s to ensure iat < changedAt
  }

  next();
});

// ── Methods ───────────────────────────────────────────────────────────────────

/**
 * Compare a plaintext password against the stored bcrypt hash.
 * @param {string} candidatePassword
 * @returns {Promise<boolean>}
 */
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Generate a raw password reset token, store the SHA-256 hash + expiry,
 * and return the raw token (to send in the email link).
 *
 * The caller MUST call user.save({ validateBeforeSave: false }) after this.
 *
 * @returns {string} raw hex token
 */
UserSchema.methods.getPasswordResetToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken  = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.passwordResetExpire = Date.now() + PASSWORD_RESET_EXPIRE;

  return rawToken;
};

/**
 * Generate a raw email verification token, store the SHA-256 hash + expiry,
 * and return the raw token (to send in the verification email).
 *
 * The caller MUST call user.save({ validateBeforeSave: false }) after this.
 *
 * @returns {string} raw hex token
 */
UserSchema.methods.getEmailVerifyToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');

  this.emailVerifyToken  = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.emailVerifyExpire = Date.now() + EMAIL_VERIFY_EXPIRE;

  return rawToken;
};

// ─────────────────────────────────────────────────────────────────────────────

const User = mongoose.model('User', UserSchema);
module.exports = User;