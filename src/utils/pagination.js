'use strict';

/**
 * utils/pagination.js — Pagination Helpers
 * ==========================================
 * Two functions used together in every paginated list controller:
 *   1. getPaginationParams(query) — safe extraction of page/limit/skip from req.query
 *   2. buildPaginationMeta(total, page, limit) — builds the pagination envelope
 */

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('./constants');

// ── getPaginationParams ───────────────────────────────────────────────────────

/**
 * Extract and sanitise pagination parameters from req.query.
 * Clamps values to safe ranges — prevents abuse (e.g. limit=999999).
 *
 * @param  {object} query  — req.query
 * @returns {{ page: number, limit: number, skip: number }}
 *
 * @example
 *   const { page, limit, skip } = getPaginationParams(req.query)
 *   const docs = await Model.find(filter).skip(skip).limit(limit)
 */
function getPaginationParams(query = {}) {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(query.limit) || DEFAULT_PAGE_SIZE)
  );
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

// ── buildPaginationMeta ───────────────────────────────────────────────────────

/**
 * Build the pagination metadata object included in every list response.
 *
 * @param  {number} total  — total matching documents (from countDocuments)
 * @param  {number} page   — current page number
 * @param  {number} limit  — items per page
 * @param  {object} [extra] — optional extra fields to merge (e.g. stats, filters)
 * @returns {object}
 *
 * @example
 *   const [docs, total] = await Promise.all([
 *     Model.find(filter).skip(skip).limit(limit).lean(),
 *     Model.countDocuments(filter),
 *   ])
 *   paginatedResponse(res, docs, buildPaginationMeta(total, page, limit))
 */
function buildPaginationMeta(total, page, limit, extra = {}) {
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    nextPage:    page < totalPages ? page + 1 : null,
    prevPage:    page > 1         ? page - 1 : null,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { getPaginationParams, buildPaginationMeta };