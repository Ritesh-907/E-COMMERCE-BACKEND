'use strict';

/**
 * validators/product.validator.js — Product Validation Schemas
 * =============================================================
 * Usage in routes:
 *   router.post('/',    protect, adminOrSeller, validate(createProductSchema), createProduct)
 *   router.patch('/:id',protect, checkOwnership(Product), validate(updateProductSchema), updateProduct)
 *
 * NOTE: Images come as req.files (multipart/form-data) — validated by
 *       upload.middleware.js (MIME type, size, count), not by Joi.
 */

const Joi = require('joi');

// ── Reusable sub-schemas ──────────────────────────────────────────────────────

// MongoDB ObjectId: 24-character hex string
const objectId = Joi.string()
  .hex()
  .length(24)
  .messages({
    'string.hex':    '{{#label}} must be a valid ID.',
    'string.length': '{{#label}} must be a valid ID.',
  });

// Tags array: up to 10 tags, each 1–30 characters, no duplicates
const tagsField = Joi.array()
  .items(
    Joi.string().trim().min(1).max(30).messages({
      'string.max': 'Each tag must not exceed 30 characters.',
    })
  )
  .max(10)
  .unique()
  .optional()
  .messages({
    'array.max':    'A product cannot have more than 10 tags.',
    'array.unique': 'Tags must be unique.',
  });

// ── createProductSchema ───────────────────────────────────────────────────────

const createProductSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(3)
    .max(200)
    .required()
    .messages({
      'string.min':   'Product name must be at least 3 characters.',
      'string.max':   'Product name must not exceed 200 characters.',
      'any.required': 'Product name is required.',
    }),

  description: Joi.string()
    .trim()
    .min(20)
    .max(5000)
    .required()
    .messages({
      'string.min':   'Description must be at least 20 characters.',
      'string.max':   'Description must not exceed 5000 characters.',
      'any.required': 'Description is required.',
    }),

  shortDesc: Joi.string()
    .trim()
    .max(200)
    .optional()
    .messages({
      'string.max': 'Short description must not exceed 200 characters.',
    }),

  price: Joi.number()
    .positive()
    .precision(2)
    .required()
    .messages({
      'number.positive': 'Price must be a positive number.',
      'number.precision': 'Price must have at most 2 decimal places.',
      'any.required':    'Price is required.',
    }),

  // comparePrice must be strictly greater than price (for the "was $X" display)
  comparePrice: Joi.number()
    .positive()
    .precision(2)
    .greater(Joi.ref('price'))
    .optional()
    .messages({
      'number.greater':   'Compare price must be greater than the selling price.',
      'number.positive':  'Compare price must be a positive number.',
      'number.precision': 'Compare price must have at most 2 decimal places.',
    }),

  category: objectId
    .required()
    .messages({ 'any.required': 'Category is required.' }),

  stock: Joi.number()
    .integer()
    .min(0)
    .required()
    .messages({
      'number.integer':  'Stock must be a whole number.',
      'number.min':      'Stock cannot be negative.',
      'any.required':    'Stock quantity is required.',
    }),

  sku: Joi.string()
    .trim()
    .max(50)
    .optional()
    .messages({
      'string.max': 'SKU must not exceed 50 characters.',
    }),

  brand: Joi.string()
    .trim()
    .max(100)
    .optional()
    .messages({
      'string.max': 'Brand must not exceed 100 characters.',
    }),

  tags: tagsField,

  isFeatured:  Joi.boolean().optional(),
  isPublished: Joi.boolean().optional().default(false),

  // Flexible key-value pairs for product attributes: { color: 'Red', size: 'XL' }
  attributes: Joi.object()
    .pattern(
      Joi.string().max(50),   // key
      Joi.alternatives().try( // value: string, number, or boolean
        Joi.string().max(200),
        Joi.number(),
        Joi.boolean()
      )
    )
    .optional()
    .messages({
      'object.base': 'Attributes must be a key-value object.',
    }),
});

// ── updateProductSchema ───────────────────────────────────────────────────────
// All fields optional — PATCH semantics.
// .fork() makes every listed key optional without rewriting the schema.

const updateProductSchema = createProductSchema
  .fork(
    [
      'name', 'description', 'price', 'category', 'stock',
    ],
    (schema) => schema.optional()
  )
  .keys({
    // Array of Cloudinary public_ids to delete from the existing images
    removeImages: Joi.array()
      .items(Joi.string().trim())
      .optional()
      .messages({
        'array.base': 'removeImages must be an array of image IDs.',
      }),
  })
  .min(1)  // At least one field required for a PATCH
  .messages({
    'object.min': 'Please provide at least one field to update.',
  });

// ── productQuerySchema ────────────────────────────────────────────────────────
// Validates GET /products query parameters.

const productQuerySchema = Joi.object({
  page:     Joi.number().integer().min(1).optional(),
  limit:    Joi.number().integer().min(1).max(100).optional(),
  sort:     Joi.string().optional(),
  fields:   Joi.string().optional(),
  search:   Joi.string().trim().max(100).optional(),
  category: Joi.string().optional(),          // Supports comma-separated or single
  brand:    Joi.string().trim().max(100).optional(),
  'price[gte]': Joi.number().min(0).optional(),
  'price[lte]': Joi.number().min(0).optional(),
  isFeatured:   Joi.boolean().truthy('true').falsy('false').optional(),
}).options({ allowUnknown: true }); // Allow other Mongoose filter params

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
};