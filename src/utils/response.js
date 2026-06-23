'use strict';

/**
 * utils/response.js — Standardised API Response Helpers
 * ========================================================
 * Enforces a consistent JSON response shape across all controllers.
 * Every successful API response uses one of these helpers —
 * res.json() is never called directly in controllers.
 *
 * Shape:
 *   { success: true, message, data, [pagination] }
 *
 * The error shape (from error.middleware.js) mirrors this:
 *   { success: false, message, [errors] }
 */

// ── successResponse ───────────────────────────────────────────────────────────

/**
 * Standard 200 (or custom status) success response.
 *
 * @param {import('express').Response} res
 * @param {object|null}  data
 * @param {string}       [message='Success']
 * @param {number}       [statusCode=200]
 */
function successResponse(res, data = null, message = 'Success', statusCode = 200) {
  const body = { success: true, message };
  if (data !== null && data !== undefined) body.data = data;
  return res.status(statusCode).json(body);
}

// ── createdResponse ───────────────────────────────────────────────────────────

/**
 * 201 Created — for POST endpoints that create new resources.
 *
 * @param {import('express').Response} res
 * @param {object|null}  data
 * @param {string}       [message='Created successfully']
 */
function createdResponse(res, data = null, message = 'Created successfully') {
  return successResponse(res, data, message, 201);
}

// ── paginatedResponse ─────────────────────────────────────────────────────────

/**
 * 200 response with a pagination envelope.
 * `pagination` is the object returned by buildPaginationMeta().
 *
 * @param {import('express').Response} res
 * @param {Array}   data           — the page of documents
 * @param {object}  pagination     — { total, page, limit, totalPages, … }
 * @param {string}  [message='Success']
 */
function paginatedResponse(res, data, pagination, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    count:      data.length,    // Items on this page (handy for clients)
    pagination,
    data,
  });
}

// ── noContentResponse ─────────────────────────────────────────────────────────

/**
 * 204 No Content — for DELETE endpoints that return nothing.
 * Note: 204 must not include a body.
 *
 * @param {import('express').Response} res
 */
function noContentResponse(res) {
  return res.status(204).send();
}

// ── errorResponse ─────────────────────────────────────────────────────────────

/**
 * Explicit error response helper — prefer next(new AppError(…)) in controllers
 * so the global errorHandler can normalise the shape. This is provided for the
 * rare case where a direct response is needed (e.g. inside webhook handlers that
 * have already sent 200 to Stripe).
 *
 * @param {import('express').Response} res
 * @param {string}  message
 * @param {number}  [statusCode=500]
 * @param {Array}   [errors]
 */
function errorResponse(res, message = 'An error occurred', statusCode = 500, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  successResponse,
  createdResponse,
  paginatedResponse,
  noContentResponse,
  errorResponse,
};