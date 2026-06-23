'use strict';

/**
 * utils/AppError.js — Custom Operational Error Class
 * =====================================================
 * Extends the native Error with an HTTP statusCode, a status string,
 * an isOperational flag, and an optional field-level errors array.
 *
 * isOperational = true  → intentional app error, safe to show message to client
 * isOperational = false → programming mistake, show generic 500 in production
 */

class AppError extends Error {
  /**
   * @param {string}        message    — human-readable error message sent to the client
   * @param {number}        statusCode — HTTP status code (400, 401, 403, 404, 422, 500 …)
   * @param {Array|null}    [errors]   — optional field-level details:
   *                                     [{ field: 'email', message: 'is required' }]
   */
  constructor(message, statusCode, errors = null) {
    super(message);

    this.statusCode = statusCode;

    // 4xx = 'fail'  (client error)
    // 5xx = 'error' (server error)
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';

    // Marks this error as intentional — error.middleware.js uses this flag
    // to decide whether to expose the message in production
    this.isOperational = true;

    // Field-level validation / business-rule details for the client
    // (e.g. from validate.middleware.js or Mongoose ValidationError normaliser)
    this.errors = errors;

    // Capture a clean stack trace that excludes this constructor frame
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;