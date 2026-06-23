'use strict';

/**
 * validators/order.validator.js — Order Validation Schemas
 * ===========================================================
 * Usage in routes:
 *   router.post('/',         protect, validate(createOrderSchema),       createOrder)
 *   router.patch('/:id/status', protect, adminOnly, validate(updateOrderStatusSchema), updateOrderStatus)
 *   router.post('/:id/cancel',  protect, validate(cancelOrderSchema),    cancelOrder)
 *   router.patch('/:id/tracking',protect, adminOnly, validate(trackingSchema), addTrackingNumber)
 */

const Joi = require('joi');
const { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } = require('../utils/enums');

// ── Reusable sub-schemas ──────────────────────────────────────────────────────

const objectId = Joi.string()
  .hex()
  .length(24)
  .messages({
    'string.hex':    '{{#label}} must be a valid ID.',
    'string.length': '{{#label}} must be a valid ID.',
  });

// Shared shipping address sub-schema (used in createOrderSchema and standalone)
const shippingAddressSchema = Joi.object({
  street: Joi.string()
    .trim()
    .min(3)
    .max(200)
    .required()
    .messages({ 'any.required': 'Street address is required.' }),

  city: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({ 'any.required': 'City is required.' }),

  state: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({ 'any.required': 'State / province is required.' }),

  zip: Joi.string()
    .trim()
    .min(2)
    .max(20)
    .pattern(/^[\w\s-]+$/)
    .required()
    .messages({
      'any.required':        'ZIP / postal code is required.',
      'string.pattern.base': 'ZIP / postal code contains invalid characters.',
    }),

  country: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({ 'any.required': 'Country is required.' }),

  phone: Joi.string()
    .trim()
    .pattern(/^[+\d\s\-().]{7,20}$/)
    .required()
    .messages({
      'any.required':        'Phone number is required for delivery.',
      'string.pattern.base': 'Please provide a valid phone number.',
    }),
});

// ── createOrderSchema ─────────────────────────────────────────────────────────

const createOrderSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        product: objectId
          .required()
          .messages({ 'any.required': 'Product ID is required for each item.' }),

        quantity: Joi.number()
          .integer()
          .min(1)
          .max(100) // Cap per-line-item quantity to prevent abuse
          .required()
          .messages({
            'number.integer': 'Quantity must be a whole number.',
            'number.min':     'Quantity must be at least 1.',
            'number.max':     'Quantity per item cannot exceed 100.',
            'any.required':   'Quantity is required for each item.',
          }),
      })
    )
    .min(1)
    .max(50) // Cap total distinct items per order
    .required()
    .messages({
      'array.min':    'Order must contain at least one item.',
      'array.max':    'An order cannot contain more than 50 distinct items.',
      'any.required': 'Order items are required.',
    }),

  shippingAddress: shippingAddressSchema.required().messages({
    'any.required': 'Shipping address is required.',
  }),

  paymentMethod: Joi.string()
    .valid(...Object.values(PAYMENT_METHOD))
    .required()
    .messages({
      'any.only':     `Payment method must be one of: ${Object.values(PAYMENT_METHOD).join(', ')}.`,
      'any.required': 'Payment method is required.',
    }),

  couponCode: Joi.string()
    .trim()
    .uppercase()
    .min(3)
    .max(20)
    .optional()
    .messages({
      'string.min': 'Coupon code must be at least 3 characters.',
      'string.max': 'Coupon code must not exceed 20 characters.',
    }),

  notes: Joi.string()
    .trim()
    .max(500)
    .optional()
    .allow('')
    .messages({
      'string.max': 'Order notes must not exceed 500 characters.',
    }),
});

// ── updateOrderStatusSchema ───────────────────────────────────────────────────

const updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...Object.values(ORDER_STATUS))
    .required()
    .messages({
      'any.only':     `Status must be one of: ${Object.values(ORDER_STATUS).join(', ')}.`,
      'any.required': 'Order status is required.',
    }),

  // Optional: admin can also update payment status manually
  paymentStatus: Joi.string()
    .valid(...Object.values(PAYMENT_STATUS))
    .optional()
    .messages({
      'any.only': `Payment status must be one of: ${Object.values(PAYMENT_STATUS).join(', ')}.`,
    }),

  reason: Joi.string()
    .trim()
    .max(500)
    .optional()
    .messages({
      'string.max': 'Reason must not exceed 500 characters.',
    }),
});

// ── cancelOrderSchema ─────────────────────────────────────────────────────────

const cancelOrderSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .max(500)
    .optional()
    .allow('')
    .messages({
      'string.max': 'Cancellation reason must not exceed 500 characters.',
    }),
});

// ── trackingSchema ────────────────────────────────────────────────────────────

const trackingSchema = Joi.object({
  trackingNumber: Joi.string()
    .trim()
    .min(5)
    .max(100)
    .required()
    .messages({
      'string.min':   'Tracking number must be at least 5 characters.',
      'string.max':   'Tracking number must not exceed 100 characters.',
      'any.required': 'Tracking number is required.',
    }),

  // If true, automatically advances status to 'shipped' (default: true)
  autoShip: Joi.boolean().optional().default(true),
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createOrderSchema,
  updateOrderStatusSchema,
  cancelOrderSchema,
  trackingSchema,
  shippingAddressSchema, // Exported for reuse in payment validator or tests
};