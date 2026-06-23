'use strict';

/**
 * utils/asyncHandler.js — Async Controller Wrapper
 * ==================================================
 * Eliminates try/catch boilerplate in every async controller.
 * Wraps the function in a Promise and pipes any rejection to next()
 * so the global errorHandler in error.middleware.js handles it.
 *
 * Works with controllers, middleware, and any Express handler function.
 *
 * @param  {Function} fn — async (req, res, next) => void
 * @returns {Function}     Express middleware
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;