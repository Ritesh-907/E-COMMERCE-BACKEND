'use strict';

/**
 * services/coupon.service.js — Coupon Validation & Application
 * ==============================================================
 * Returns result objects (never throws on invalid coupons) so controllers
 * can present friendly messages rather than catching exceptions.
 * Only markCouponUsed() throws — it should always succeed.
 */

const Coupon   = require('../models/Coupon');
const AppError = require('../utils/AppError');
const logger   = require('../utils/logger');

// ── validateAndApplyCoupon ────────────────────────────────────────────────────

/**
 * Validate a coupon code for a given user and order total.
 * Returns a result object — never throws — so callers get the reason text.
 *
 * @param  {string} code         — coupon code (case-insensitive)
 * @param  {string} userId       — authenticated user's ID
 * @param  {number} orderTotal   — cart subtotal in dollars
 * @returns {Promise<{
 *   valid: boolean,
 *   discountAmount?: number,
 *   coupon?: CouponDocument,
 *   reason?: string
 * }>}
 */
async function validateAndApplyCoupon(code, userId, orderTotal) {
  // Normalize early — all codes stored uppercase
  const normalizedCode = code.trim().toUpperCase();

  let coupon;
  try {
    coupon = await Coupon.findOne({ code: normalizedCode });
  } catch (err) {
    logger.error('validateAndApplyCoupon: DB query failed', { code, error: err.message });
    return { valid: false, reason: 'Unable to validate coupon. Please try again.' };
  }

  if (!coupon) {
    return { valid: false, reason: 'Coupon code not found.' };
  }

  // Delegate all validity checks to the model method
  // coupon.isValid() throws AppError with the specific reason
  try {
    coupon.isValid(userId, orderTotal);
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  const discountAmount = coupon.calculateDiscount(orderTotal);

  logger.debug('Coupon validated', {
    code:           normalizedCode,
    userId,
    orderTotal,
    discountAmount,
  });

  return { valid: true, discountAmount, coupon };
}

// ── markCouponUsed ────────────────────────────────────────────────────────────

/**
 * Record a coupon use after an order is successfully created.
 * MUST be called inside the same Mongoose session as the order creation
 * to ensure atomicity (if the order fails, the coupon is not marked used).
 *
 * @param  {string|mongoose.Types.ObjectId} couponId
 * @param  {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<void>}
 * @throws {AppError} if the coupon document is not found
 */
async function markCouponUsed(couponId, userId) {
  const result = await Coupon.findByIdAndUpdate(
    couponId,
    {
      $inc:  { usedCount: 1 },
      $push: { usedBy:    userId },
    },
    { new: true }
  );

  if (!result) {
    throw new AppError('Coupon not found when marking as used.', 404);
  }

  logger.debug('Coupon marked as used', { couponId, userId });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { validateAndApplyCoupon, markCouponUsed };