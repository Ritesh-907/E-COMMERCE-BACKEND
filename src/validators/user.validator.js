'use strict';

/**
 * validators/user.validator.js — User Profile Validation Schemas
 * ================================================================
 * Usage in routes:
 *   router.patch('/me',            validate(updateUserSchema),       updateMe)
 *   router.post('/me/address',     validate(addressSchema),          addAddress)
 *   router.patch('/me/address/:id',validate(updateAddressSchema),    updateAddress)
 *   router.patch('/:id',           validate(adminUpdateUserSchema),  updateUser)   // admin
 */

const Joi = require('joi');
const { USER_ROLES } = require('../utils/enums');

// ── updateUserSchema — user updating their own profile (/me) ──────────────────
// Only name and phone are editable — email, role, and isActive are separate flows.

const updateUserSchema = Joi.object({
  name: Joi.string()
    .min(2)
    .max(50)
    .trim()
    .pattern(/^[a-zA-Z\s'-]+$/)
    .optional()
    .messages({
      'string.min':          'Name must be at least 2 characters.',
      'string.max':          'Name must not exceed 50 characters.',
      'string.pattern.base': 'Name can only contain letters, spaces, hyphens, and apostrophes.',
    }),

  phone: Joi.string()
    .trim()
    .pattern(/^[+\d\s\-().]{7,20}$/)
    .optional()
    .allow('')    // Allow clearing the phone number
    .messages({
      'string.pattern.base': 'Please enter a valid phone number (7–20 characters, digits, spaces, +, -, (, ) allowed).',
    }),
});

// ── adminUpdateUserSchema — admin updating another user ───────────────────────
// Tightly scoped: only role and isActive to prevent mass-assignment attacks.

const adminUpdateUserSchema = Joi.object({
  role: Joi.string()
    .valid(...Object.values(USER_ROLES))
    .optional()
    .messages({
      'any.only': `Role must be one of: ${Object.values(USER_ROLES).join(', ')}.`,
    }),

  isActive: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'isActive must be a boolean value.',
    }),
})
  .min(1) // At least one field must be provided for a PATCH
  .messages({
    'object.min': 'Please provide at least one field to update.',
  });

// ── addressSchema — add a new address ────────────────────────────────────────

const addressSchema = Joi.object({
  street: Joi.string()
    .trim()
    .min(3)
    .max(200)
    .required()
    .messages({
      'string.min':   'Street must be at least 3 characters.',
      'string.max':   'Street must not exceed 200 characters.',
      'any.required': 'Street is required.',
    }),

  city: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'any.required': 'City is required.',
    }),

  state: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'any.required': 'State/province is required.',
    }),

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
    .messages({
      'any.required': 'Country is required.',
    }),

  phone: Joi.string()
    .trim()
    .pattern(/^[+\d\s\-().]{7,20}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Please enter a valid phone number.',
    }),

  label: Joi.string()
    .valid('Home', 'Office', 'Other')
    .optional()
    .default('Home')
    .messages({
      'any.only': 'Label must be Home, Office, or Other.',
    }),

  isDefault: Joi.boolean().optional(),
});

// ── updateAddressSchema — update an existing address ─────────────────────────
// Same shape as addressSchema but all fields optional — supports partial PATCH.

const updateAddressSchema = addressSchema.fork(
  ['street', 'city', 'state', 'zip', 'country'],
  (schema) => schema.optional()
);

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  updateUserSchema,
  adminUpdateUserSchema,
  addressSchema,
  updateAddressSchema,
};