'use strict';

/**
 * validators/auth.validator.js — Auth Request Validation Schemas
 * ================================================================
 * All schemas use stripUnknown:true and abortEarly:false via
 * validate.middleware.js — no need to set options on each schema.
 *
 * Usage in routes:
 *   router.post('/register',       validate(registerSchema),        register)
 *   router.post('/login',          validate(loginSchema),           login)
 *   router.post('/forgot-password',validate(forgotPasswordSchema),  forgotPassword)
 *   router.post('/reset-password/:token', validate(resetPasswordSchema), resetPassword)
 *   router.patch('/me/password',   validate(updatePasswordSchema),  updatePassword)
 */

const Joi = require('joi');

// ── Reusable sub-schemas ──────────────────────────────────────────────────────

/**
 * Strong password rule:
 *   - 8–128 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *   - At least one special character
 */
const strongPassword = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/)
  .required()
  .messages({
    'string.min':          'Password must be at least 8 characters.',
    'string.max':          'Password must not exceed 128 characters.',
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
    'any.required':        'Password is required.',
  });

const emailField = Joi.string()
  .email({ tlds: { allow: false } }) // Don't validate TLDs — avoids rejecting new TLDs
  .lowercase()
  .trim()
  .max(254) // RFC 5321 max email length
  .required()
  .messages({
    'string.email':    'Please provide a valid email address.',
    'any.required':    'Email is required.',
  });

// ── registerSchema ────────────────────────────────────────────────────────────

const registerSchema = Joi.object({
  name: Joi.string()
    .min(2)
    .max(50)
    .trim()
    .pattern(/^[a-zA-Z\s'-]+$/) // Allow letters, spaces, hyphens, apostrophes
    .required()
    .messages({
      'string.min':          'Name must be at least 2 characters.',
      'string.max':          'Name must not exceed 50 characters.',
      'string.pattern.base': 'Name can only contain letters, spaces, hyphens, and apostrophes.',
      'any.required':        'Name is required.',
    }),

  email: emailField,

  password: strongPassword,

  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .required()
    .messages({
      'any.only':     'Passwords do not match.',
      'any.required': 'Please confirm your password.',
    }),
});

// ── loginSchema ───────────────────────────────────────────────────────────────

const loginSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address.',
      'any.required': 'Email is required.',
    }),

  // No strength rules on login — just check it's present
  // (avoids leaking which constraint failed if the password has been reset)
  password: Joi.string()
    .required()
    .messages({ 'any.required': 'Password is required.' }),
});

// ── forgotPasswordSchema ──────────────────────────────────────────────────────

const forgotPasswordSchema = Joi.object({
  email: emailField,
});

// ── resetPasswordSchema ───────────────────────────────────────────────────────

const resetPasswordSchema = Joi.object({
  password: strongPassword,

  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .required()
    .messages({
      'any.only':     'Passwords do not match.',
      'any.required': 'Please confirm your new password.',
    }),
});

// ── updatePasswordSchema (for authenticated users) ────────────────────────────

const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({ 'any.required': 'Current password is required.' }),

  newPassword: strongPassword.messages({
    'string.min':          'New password must be at least 8 characters.',
    'string.max':          'New password must not exceed 128 characters.',
    'string.pattern.base': 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
    'any.required':        'New password is required.',
  }),

  confirmPassword: Joi.string()
    .valid(Joi.ref('newPassword'))
    .required()
    .messages({
      'any.only':     'Passwords do not match.',
      'any.required': 'Please confirm your new password.',
    }),
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updatePasswordSchema,
};