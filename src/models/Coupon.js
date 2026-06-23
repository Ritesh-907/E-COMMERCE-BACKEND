'use strict';

/**
 * models/Coupon.js — Coupon Schema & Model
 * ==========================================
 */

const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { COUPON_TYPE } = require('../utils/enums');

// ── CouponSchema ──────────────────────────────────────────────────────────────

const CouponSchema = new mongoose.Schema(
  {
    code: {
      type:      String,
      required:  [true, 'Coupon code is required.'],
      unique:    true,
      uppercase: true,
      trim:      true,
      minlength: [3,  'Coupon code must be at least 3 characters.'],
      maxlength: [20, 'Coupon code must not exceed 20 characters.'],
    },

    type: {
      type:     String,
      enum:     Object.values(COUPON_TYPE),
      required: [true, 'Coupon type is required.'],
    },

    discount: {
      type:     Number,
      required: [true, 'Discount value is required.'],
      min:      [0, 'Discount cannot be negative.'],
    },

    // Minimum cart total before the coupon applies
    minOrderValue: {
      type:    Number,
      default: 0,
      min:     [0, 'Minimum order value cannot be negative.'],
    },

    // Cap for percentage coupons: e.g. 20% off but no more than $50
    maxDiscount: {
      type:    Number,
      default: null,
      min:     [0, 'Max discount cannot be negative.'],
    },

    // Total uses allowed across all users (null = unlimited)
    usageLimit: {
      type:    Number,
      default: null,
    },

    // Actual number of times this coupon has been used
    usedCount: {
      type:    Number,
      default: 0,
    },

    // Max uses per individual user
    userLimit: {
      type:    Number,
      default: 1,
    },

    // Users who have used this coupon — used to enforce userLimit
    usedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // Scope restrictions — empty array = applies to everything
    applicableProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    ],

    applicableCategories: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    ],

    startDate:  { type: Date, default: Date.now },
    expiryDate: { type: Date, required: [true, 'Expiry date is required.'] },

    isActive:    { type: Boolean, default: true },
    description: { type: String, maxlength: 200 }, // Internal admin note
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

CouponSchema.index({ code:       1 }, { unique: true });
CouponSchema.index({ expiryDate: 1 });
CouponSchema.index({ isActive:   1 });

// ── Pre-save hook: normalise code ─────────────────────────────────────────────

CouponSchema.pre('save', function (next) {
  if (this.isModified('code')) {
    this.code = this.code.toUpperCase().trim();
  }
  next();
});

// ── Methods ───────────────────────────────────────────────────────────────────

/**
 * Validate whether a coupon is usable for a given user and order total.
 * Throws AppError with a descriptive reason if invalid.
 * Returns true if valid — allows coupon.service to use this as a guard.
 *
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {number}                         orderTotal
 * @returns {true}
 * @throws {AppError}
 */
CouponSchema.methods.isValid = function (userId, orderTotal) {
  const now = Date.now();

  if (!this.isActive) {
    throw new AppError('This coupon is no longer active.', 400);
  }

  if (this.startDate && this.startDate > now) {
    throw new AppError('This coupon is not yet valid.', 400);
  }

  if (this.expiryDate < now) {
    throw new AppError('This coupon has expired.', 400);
  }

  if (this.usageLimit !== null && this.usedCount >= this.usageLimit) {
    throw new AppError('This coupon has reached its usage limit.', 400);
  }

  // Count how many times THIS user has used the coupon
  const userUseCount = this.usedBy.filter(
    (id) => id.toString() === userId.toString()
  ).length;

  if (userUseCount >= this.userLimit) {
    throw new AppError(
      `You have already used this coupon the maximum number of times (${this.userLimit}).`,
      400
    );
  }

  if (orderTotal < this.minOrderValue) {
    throw new AppError(
      `This coupon requires a minimum order of $${this.minOrderValue.toFixed(2)}.`,
      400
    );
  }

  return true;
};

/**
 * Calculate the discount amount for a given order total.
 * Never returns more than the order total (minimum final price = $0).
 *
 * @param {number} orderTotal
 * @returns {number} discount amount (rounded to 2 decimal places)
 */
CouponSchema.methods.calculateDiscount = function (orderTotal) {
  let discount;

  if (this.type === COUPON_TYPE.PERCENTAGE) {
    const raw = (this.discount / 100) * orderTotal;
    // Apply maxDiscount cap if set
    discount = this.maxDiscount != null
      ? Math.min(raw, this.maxDiscount)
      : raw;
  } else {
    // Fixed amount — cannot exceed the order total
    discount = Math.min(this.discount, orderTotal);
  }

  return Math.round(Math.max(0, discount) * 100) / 100; // 2 d.p., never negative
};

// ─────────────────────────────────────────────────────────────────────────────

const Coupon = mongoose.model('Coupon', CouponSchema);
module.exports = Coupon;