'use strict';

/**
 * validators/coupon.validator.js — Coupon Validation Schemas
 * ===========================================================
 * Usage in routes:
 *   router.post('/',        protect, adminOnly, validate(createCouponSchema),   createCoupon)
 *   router.patch('/:id',   protect, adminOnly, validate(updateCouponSchema),   updateCoupon)
 *   router.post('/validate',protect, validate(validateCouponBodySchema),        validateCoupon)
 */

const Joi = require('joi');
const { COUPON_TYPE } = require('../utils/enums');

// ── Reusable sub-schemas ──────────────────────────────────────────────────────

const objectId = Joi.string()
  .hex()
  .length(24)
  .messages({
    'string.hex':    '{{#label}} must be a valid ID.',
    'string.length': '{{#label}} must be a valid ID.',
  });

const couponCode = Joi.string()
  .trim()
  .uppercase()
  .alphanum()
  .min(3)
  .max(20)
  .messages({
    'string.alphanum': 'Coupon code can only contain letters and numbers.',
    'string.min':      'Coupon code must be at least 3 characters.',
    'string.max':      'Coupon code must not exceed 20 characters.',
  });

// ── createCouponSchema ────────────────────────────────────────────────────────

const createCouponSchema = Joi.object({
  code: couponCode.required().messages({
    'any.required': 'Coupon code is required.',
  }),

  type: Joi.string()
    .valid(...Object.values(COUPON_TYPE))
    .required()
    .messages({
      'any.only':     `Type must be one of: ${Object.values(COUPON_TYPE).join(', ')}.`,
      'any.required': 'Coupon type is required.',
    }),

  // Percentage coupons: 1–100. Fixed coupons: any positive amount.
  discount: Joi.when('type', {
    is:   COUPON_TYPE.PERCENTAGE,
    then: Joi.number()
      .positive()
      .max(100)
      .precision(2)
      .required()
      .messages({
        'number.max':      'Percentage discount cannot exceed 100%.',
        'number.positive': 'Discount must be a positive number.',
        'any.required':    'Discount value is required.',
      }),
    otherwise: Joi.number()
      .positive()
      .precision(2)
      .required()
      .messages({
        'number.positive': 'Discount amount must be a positive number.',
        'any.required':    'Discount value is required.',
      }),
  }),

  // Minimum order value the coupon applies to
  minOrderValue: Joi.number()
    .min(0)
    .precision(2)
    .optional()
    .default(0)
    .messages({
      'number.min': 'Minimum order value cannot be negative.',
    }),

  // Cap the discount for percentage coupons (e.g. 20% off but no more than $50)
  // Only meaningful for percentage type — enforced by conditional in service layer
  maxDiscount: Joi.number()
    .positive()
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Maximum discount must be a positive number.',
    }),

  // How many times the coupon can be used in total (null = unlimited)
  usageLimit: Joi.number()
    .integer()
    .positive()
    .optional()
    .allow(null)
    .messages({
      'number.integer':  'Usage limit must be a whole number.',
      'number.positive': 'Usage limit must be a positive number.',
    }),

  // How many times a single user can use this coupon (default: 1)
  userLimit: Joi.number()
    .integer()
    .positive()
    .optional()
    .default(1)
    .messages({
      'number.integer':  'Per-user limit must be a whole number.',
      'number.positive': 'Per-user limit must be a positive number.',
    }),

  // Coupon only applies to these specific products (null = all products)
  applicableProducts: Joi.array()
    .items(objectId)
    .optional()
    .allow(null)
    .messages({
      'array.base': 'applicableProducts must be an array of product IDs.',
    }),

  // Coupon only applies to items in these categories (null = all categories)
  applicableCategories: Joi.array()
    .items(objectId)
    .optional()
    .allow(null)
    .messages({
      'array.base': 'applicableCategories must be an array of category IDs.',
    }),

  // Coupon becomes active from this date (null = active immediately)
  startDate: Joi.date()
    .iso()
    .optional()
    .allow(null)
    .messages({
      'date.format': 'startDate must be a valid ISO 8601 date.',
    }),

  // Coupon expires at this date — must be in the future at creation time
  expiryDate: Joi.date()
    .iso()
    .greater('now')
    .required()
    .messages({
      'date.greater':  'Expiry date must be in the future.',
      'date.format':   'expiryDate must be a valid ISO 8601 date.',
      'any.required':  'Expiry date is required.',
    }),

  isActive: Joi.boolean().optional().default(true),

  description: Joi.string()
    .trim()
    .max(200)
    .optional()
    .allow('')
    .messages({
      'string.max': 'Description must not exceed 200 characters.',
    }),
});

// ── updateCouponSchema ────────────────────────────────────────────────────────
// All fields optional for PATCH semantics.
// expiryDate no longer requires greater('now') — admin may correct an already-past date.

const updateCouponSchema = createCouponSchema
  .fork(
    ['code', 'type', 'discount', 'expiryDate'],
    (schema) => schema.optional()
  )
  .keys({
    // Allow updating expiryDate to any ISO date on updates (not just future)
    expiryDate: Joi.date().iso().optional().messages({
      'date.format': 'expiryDate must be a valid ISO 8601 date.',
    }),
  })
  .min(1)
  .messages({
    'object.min': 'Please provide at least one field to update.',
  });

// ── validateCouponBodySchema — user-facing validation endpoint ────────────────

const validateCouponBodySchema = Joi.object({
  code: Joi.string()
    .trim()
    .uppercase()
    .min(3)
    .max(20)
    .required()
    .messages({
      'any.required': 'Coupon code is required.',
      'string.min':   'Coupon code must be at least 3 characters.',
      'string.max':   'Coupon code must not exceed 20 characters.',
    }),

  orderTotal: Joi.number()
    .positive()
    .required()
    .messages({
      'number.positive': 'Order total must be a positive number.',
      'any.required':    'Order total is required to validate the coupon.',
    }),
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createCouponSchema,
  updateCouponSchema,
  validateCouponBodySchema,
};