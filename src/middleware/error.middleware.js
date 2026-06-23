'use strict';

/**
 * middleware/error.middleware.js — Global Error Handler
 * =======================================================
 * Must be mounted LAST in app.js — after all routes and notFound middleware.
 * Receives every error forwarded via next(err) or thrown in asyncHandler.
 *
 * Normalises Mongoose, JWT, and Multer errors into AppError-shaped objects,
 * then sends a consistent JSON response.
 */

const multer   = require('multer');
const AppError = require('../utils/AppError');
const logger   = require('../utils/logger');

// ── Mongoose / driver error normalisers ───────────────────────────────────────

/**
 * Mongoose CastError — invalid ObjectId, enum value, or type mismatch.
 * e.g. GET /products/not-an-id
 */
function handleCastError(err) {
  return new AppError(`Invalid ${err.path}: "${err.value}".`, 400);
}

/**
 * Mongoose ValidationError — document failed schema validation.
 * Collect all field messages into a single readable string AND
 * pass them as an errors array for field-level UI rendering.
 */
function handleValidationError(err) {
  const errors = Object.values(err.errors).map((e) => ({
    field:   e.path,
    message: e.message,
  }));

  const message = errors.map((e) => e.message).join('. ');
  return new AppError(message, 422, errors);
}

/**
 * MongoDB duplicate key error (code 11000).
 * e.g. registering with an email that already exists.
 */
function handleDuplicateKeyError(err) {
  const field = Object.keys(err.keyValue || {})[0] || 'field';
  const value = err.keyValue?.[field];
  return new AppError(
    `"${value}" is already taken for field "${field}". Please use a different value.`,
    400
  );
}

/**
 * JWT errors — malformed or tampered token.
 */
function handleJwtError() {
  return new AppError('Invalid token. Please log in again.', 401);
}

/**
 * JWT expiry — valid structure but past its exp claim.
 */
function handleJwtExpiredError() {
  return new AppError('Your session has expired. Please log in again.', 401);
}

/**
 * Multer errors — file size exceeded or wrong field name.
 */
function handleMulterError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError('File too large. Maximum allowed size is 5 MB.', 400);
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return new AppError('Too many files uploaded at once.', 400);
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError(`Unexpected form field: "${err.field}".`, 400);
  }
  return new AppError(`Upload error: ${err.message}`, 400);
}

// ── Development response (full detail) ───────────────────────────────────────

function sendDevError(err, res) {
  res.status(err.statusCode).json({
    success:    false,
    status:     err.status,
    message:    err.message,
    errors:     err.errors  || undefined,
    stack:      err.stack,
    // Raw error object for deep inspection
    error: {
      name:    err.name,
      message: err.message,
      code:    err.code,
    },
  });
}

// ── Production response (sanitised) ──────────────────────────────────────────

function sendProdError(err, res) {
  if (err.isOperational) {
    // Intentional AppError — safe to show to the client
    return res.status(err.statusCode).json({
      success:  false,
      message:  err.message,
      errors:   err.errors || undefined,
    });
  }

  // Programming or unknown error — never leak internals
  logger.error('Unhandled non-operational error', {
    message: err.message,
    stack:   err.stack,
  });

  return res.status(500).json({
    success:  false,
    message:  'Something went wrong. Please try again later.',
  });
}

// ── Global error handler ──────────────────────────────────────────────────────
// 4-parameter signature is required by Express to identify as error middleware

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Clone so we don't mutate the original error
  let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
  error.message    = err.message;
  error.statusCode = err.statusCode || 500;
  error.status     = err.status     || 'error';

  // ── Normalise known error types ───────────────────────────────────────────

  if (error.name  === 'CastError')           error = handleCastError(error);
  if (error.name  === 'ValidationError')     error = handleValidationError(error);
  if (error.code  === 11000)                 error = handleDuplicateKeyError(error);
  if (error.name  === 'JsonWebTokenError')   error = handleJwtError();
  if (error.name  === 'TokenExpiredError')   error = handleJwtExpiredError();
  if (error instanceof multer.MulterError)   error = handleMulterError(error);

  // ── Log server errors (5xx) ───────────────────────────────────────────────

  if (error.statusCode >= 500) {
    logger.error('Server error', {
      message:    error.message,
      stack:      error.stack,
      method:     req.method,
      url:        req.originalUrl,
      userId:     req.user?._id,
      ip:         req.ip,
    });
  }

  // ── Send response ─────────────────────────────────────────────────────────

  if (process.env.NODE_ENV === 'development') {
    return sendDevError(error, res);
  }

  return sendProdError(error, res);
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { errorHandler };