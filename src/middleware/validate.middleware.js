'use strict';

/**
 * middleware/validate.middleware.js — Joi Request Validation
 * ============================================================
 * Validates req.body / req.params / req.query against a Joi schema.
 * On failure forwards a 422 AppError with field-level error details.
 * On success replaces req[source] with the sanitised Joi output.
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), register)
 *   router.get('/:id',       validate(idSchema, 'params'), getById)
 *   router.get('/',          validate(querySchema, 'query'), getAll)
 */

const AppError = require('../utils/AppError');

// ── validate ──────────────────────────────────────────────────────────────────

/**
 * @param {import('joi').Schema} schema  — Joi schema to validate against
 * @param {'body'|'params'|'query'} [source='body'] — which part of req to validate
 * @returns {Function} Express middleware
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[source], {
    // Return ALL errors at once — frontend needs every broken field in one shot
    abortEarly:    false,

    // Reject unknown keys — prevents mass-assignment of unexpected fields
    allowUnknown:  false,

    // Remove unknown keys from the validated value even if allowUnknown were true
    stripUnknown:  true,

    // Make Joi error messages slightly more readable
    errors: {
      wrap: { label: '"' },
    },
  });

  if (error) {
    const errors = error.details.map((detail) => ({
      // Convert nested path array ['address', 'city'] → 'address.city'
      field:   detail.path.join('.'),
      // Strip surrounding quotes Joi adds around field names in messages
      message: detail.message.replace(/['"]/g, ''),
    }));

    return next(new AppError('Validation failed.', 422, errors));
  }

  // Replace the source with the sanitised, coerced Joi output.
  // This means controllers receive clean data with defaults applied and
  // unknown fields already stripped.
  req[source] = value;

  next();
};

// ── validateMultiple ──────────────────────────────────────────────────────────

/**
 * Validate multiple sources in one middleware — useful when both params
 * and body need validation on the same route.
 *
 * @param {{ body?: Schema, params?: Schema, query?: Schema }} schemas
 *
 * Usage:
 *   router.patch(
 *     '/:id',
 *     validateMultiple({ params: idSchema, body: updateProductSchema }),
 *     updateProduct
 *   )
 */
const validateMultiple = (schemas) => (req, res, next) => {
  const allErrors = [];

  for (const [source, schema] of Object.entries(schemas)) {
    const { error, value } = schema.validate(req[source], {
      abortEarly:   false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      error.details.forEach((detail) => {
        allErrors.push({
          source,
          field:   detail.path.join('.'),
          message: detail.message.replace(/['"]/g, ''),
        });
      });
    } else {
      req[source] = value;
    }
  }

  if (allErrors.length > 0) {
    return next(new AppError('Validation failed.', 422, allErrors));
  }

  next();
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { validate, validateMultiple };