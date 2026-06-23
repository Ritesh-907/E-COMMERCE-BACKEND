'use strict';

/**
 * controllers/coupon.controller.js — Coupon Management
 * =======================================================
 */

const mongoose      = require('mongoose');
const Coupon        = require('../models/Coupon');
const couponService = require('../services/coupon.service');
const asyncHandler  = require('../utils/asyncHandler');
const AppError      = require('../utils/AppError');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { getPaginationParams, buildPaginationMeta } = require('../utils/pagination');

// ── validateCoupon (authenticated user) ──────────────────────────────────────
// Returns 200 even for invalid coupons — the frontend needs the reason text,
// not an HTTP error status.

exports.validateCoupon = asyncHandler(async (req, res) => {
  const { code, orderTotal } = req.body;

  if (!code) throw new AppError('Coupon code is required.', 400);

  const result = await couponService.validateAndApplyCoupon(
    code,
    req.user._id,
    parseFloat(orderTotal) || 0
  );

  if (result.valid) {
    return successResponse(res, {
      valid:          true,
      discountAmount: result.discountAmount,
      coupon: {
        code:     result.coupon.code,
        type:     result.coupon.type,
        discount: result.coupon.discount,
      },
    });
  }

  // Still 200 — the frontend decides how to display the error
  return successResponse(res, { valid: false, reason: result.reason });
});

// ── Admin: getAllCoupons ───────────────────────────────────────────────────────

exports.getAllCoupons = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query);

  // Build filter from query params
  const filter = {};
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  if (req.query.type)                   filter.type     = req.query.type;

  const [coupons, total] = await Promise.all([
    Coupon.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean(),
    Coupon.countDocuments(filter),
  ]);

  // Enrich with runtime status fields
  const now = Date.now();
  const enriched = coupons.map((c) => ({
    ...c,
    isExpired:       c.expiryDate < now,
    remainingUses:   c.usageLimit != null ? c.usageLimit - c.usedCount : null,
    usedCount:       c.usedCount,
  }));

  paginatedResponse(res, enriched, buildPaginationMeta(total, page, limit));
});

// ── Admin: getCouponById ──────────────────────────────────────────────────────

exports.getCouponById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid coupon ID.', 400);
  }

  const coupon = await Coupon.findById(req.params.id)
    .populate('usedBy', 'name email');

  if (!coupon) throw new AppError('Coupon not found.', 404);

  successResponse(res, { coupon });
});

// ── Admin: createCoupon ───────────────────────────────────────────────────────

exports.createCoupon = asyncHandler(async (req, res) => {
  // Validation is handled upstream by coupon.validator.js middleware
  const data = { ...req.body, code: req.body.code.toUpperCase() };

  const coupon = await Coupon.create(data);

  createdResponse(res, { coupon }, 'Coupon created successfully.');
});

// ── Admin: updateCoupon ───────────────────────────────────────────────────────

exports.updateCoupon = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid coupon ID.', 400);
  }

  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new AppError('Coupon not found.', 404);

  const allowed = [
    'code', 'type', 'discount', 'minOrderValue', 'maxDiscount',
    'usageLimit', 'userLimit', 'applicableProducts', 'applicableCategories',
    'startDate', 'expiryDate', 'isActive', 'description',
  ];

  allowed.forEach((f) => {
    if (req.body[f] !== undefined) coupon[f] = req.body[f];
  });

  // Uppercase code if it was changed
  if (req.body.code) coupon.code = req.body.code.toUpperCase();

  await coupon.save();

  successResponse(res, { coupon }, 'Coupon updated.');
});

// ── Admin: deleteCoupon ───────────────────────────────────────────────────────

exports.deleteCoupon = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid coupon ID.', 400);
  }

  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw new AppError('Coupon not found.', 404);

  successResponse(res, null, 'Coupon deleted.');
});

// ── Admin: getCouponStats ─────────────────────────────────────────────────────

exports.getCouponStats = asyncHandler(async (req, res) => {
  const now = new Date();

  const [summary, topCoupons] = await Promise.all([
    Coupon.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          active: [
            { $match: { isActive: true, expiryDate: { $gt: now } } },
            { $count: 'count' },
          ],
          expired: [
            { $match: { expiryDate: { $lte: now } } },
            { $count: 'count' },
          ],
          totalDiscountGiven: [
            {
              $group: {
                _id:   null,
                total: {
                  $sum: {
                    $cond: [
                      { $eq: ['$type', 'fixed'] },
                      { $multiply: ['$discount', '$usedCount'] },
                      0, // percentage coupons need order data — approximation skipped here
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]),

    // Top 5 most-used coupons
    Coupon.find()
      .sort('-usedCount')
      .limit(5)
      .select('code type discount usedCount usageLimit')
      .lean(),
  ]);

  const stats = {
    total:              summary[0].total[0]?.count || 0,
    active:             summary[0].active[0]?.count || 0,
    expired:            summary[0].expired[0]?.count || 0,
    totalDiscountGiven: summary[0].totalDiscountGiven[0]?.total || 0,
    topCoupons,
  };

  successResponse(res, { stats });
});