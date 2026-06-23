'use strict';

/**
 * validators/review.validator.js — Review Validation Schemas
 * ===========================================================
 * Usage in routes:
 *   router.post('/:productId/reviews',  protect, validate(createReviewSchema),  createReview)
 *   router.patch('/reviews/:id',        protect, validate(updateReviewSchema),   updateReview)
 *
 * NOTE:
 *   - productId comes from req.params — validated separately via checkOwnership/route guards
 *   - Images come from req.files (multipart/form-data) — validated by upload.middleware.js
 *   - removeImages is an array of Cloudinary public_ids sent as JSON in req.body
 */

const Joi = require('joi');

// ── createReviewSchema ────────────────────────────────────────────────────────

const createReviewSchema = Joi.object({
  rating: Joi.number()
    .integer()
    .min(1)
    .max(5)
    .required()
    .messages({
      'number.integer': 'Rating must be a whole number.',
      'number.min':     'Rating must be at least 1 star.',
      'number.max':     'Rating cannot exceed 5 stars.',
      'any.required':   'Rating is required.',
    }),

  title: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .optional()
    .allow('')
    .messages({
      'string.min': 'Review title must be at least 3 characters.',
      'string.max': 'Review title must not exceed 100 characters.',
    }),

  comment: Joi.string()
    .trim()
    .min(10)
    .max(1000)
    .required()
    .messages({
      'string.min':   'Review must be at least 10 characters — please share more detail.',
      'string.max':   'Review must not exceed 1000 characters.',
      'any.required': 'A written comment is required.',
    }),
});

// ── updateReviewSchema ────────────────────────────────────────────────────────
// All fields optional — supports partial PATCH updates.

const updateReviewSchema = Joi.object({
  rating: Joi.number()
    .integer()
    .min(1)
    .max(5)
    .optional()
    .messages({
      'number.integer': 'Rating must be a whole number.',
      'number.min':     'Rating must be at least 1 star.',
      'number.max':     'Rating cannot exceed 5 stars.',
    }),

  title: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .optional()
    .allow('')
    .messages({
      'string.min': 'Review title must be at least 3 characters.',
      'string.max': 'Review title must not exceed 100 characters.',
    }),

  comment: Joi.string()
    .trim()
    .min(10)
    .max(1000)
    .optional()
    .messages({
      'string.min': 'Review must be at least 10 characters.',
      'string.max': 'Review must not exceed 1000 characters.',
    }),

  // Array of Cloudinary public_ids for images to remove from the review
  removeImages: Joi.array()
    .items(Joi.string().trim())
    .max(3) // Max images per review
    .optional()
    .messages({
      'array.base': 'removeImages must be an array of image identifiers.',
      'array.max':  'Cannot remove more than 3 images at once.',
    }),
})
  .min(1)
  .messages({
    'object.min': 'Please provide at least one field to update.',
  });

// ── reviewQuerySchema — GET /products/:productId/reviews query params ─────────

const reviewQuerySchema = Joi.object({
  page:  Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(50).optional(),
  sort:  Joi.string().valid('newest', 'highest', 'liked').optional().messages({
    'any.only': 'Sort must be one of: newest, highest, liked.',
  }),
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createReviewSchema,
  updateReviewSchema,
  reviewQuerySchema,
};