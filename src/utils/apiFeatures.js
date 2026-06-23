'use strict';

/**
 * utils/apiFeatures.js — Mongoose Query Builder
 * ================================================
 * Chainable class for filtering, full-text search, sorting,
 * field projection, and pagination from URL query parameters.
 *
 * Usage:
 *   const features = new APIFeatures(Product.find({ isPublished: true }), req.query)
 *     .filter()
 *     .search(['name', 'brand', 'description'])
 *     .sort()
 *     .limitFields()
 *     .paginate()
 *
 *   const products = await features.query.populate('category').lean()
 *
 * Supports URL patterns:
 *   ?price[gte]=100&price[lte]=500   — range filters
 *   ?search=headphones               — text search across searchable fields
 *   ?sort=-price,createdAt           — multi-field sort (prefix - for desc)
 *   ?fields=name,price,images        — field projection
 *   ?page=2&limit=10                 — pagination
 */

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('./constants');

// Fields that must never be treated as Mongoose filter conditions
const EXCLUDED_QUERY_FIELDS = new Set(['page', 'sort', 'limit', 'fields', 'search']);

class APIFeatures {
  /**
   * @param {import('mongoose').Query} query        — Mongoose Query, e.g. Product.find()
   * @param {object}                   queryString  — req.query
   */
  constructor(query, queryString) {
    this.query       = query;
    this.queryString = queryString;
    this.page        = 1;
    this.limit       = DEFAULT_PAGE_SIZE;
  }

  // ── filter ─────────────────────────────────────────────────────────────────
  // Converts URL comparison operators to MongoDB operators:
  //   ?price[gte]=100  →  { price: { $gte: 100 } }

  filter() {
    const queryObj = { ...this.queryString };

    // Strip pagination / sorting / search fields so they don't leak into the filter
    EXCLUDED_QUERY_FIELDS.forEach((f) => delete queryObj[f]);

    // Replace gte|gt|lte|lt|ne with their MongoDB $ equivalents
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(
      /\b(gte|gt|lte|lt|ne|in|nin)\b/g,
      (match) => `$${match}`
    );

    this.query = this.query.find(JSON.parse(queryStr));
    return this;
  }

  // ── search ─────────────────────────────────────────────────────────────────
  // Case-insensitive regex search across multiple fields.
  // ?search=apple  →  { $or: [{ name: /apple/i }, { brand: /apple/i }] }
  //
  // NOTE: For large collections, replace with a $text search or Atlas Search:
  //   this.query = this.query.find({ $text: { $search: this.queryString.search } })
  //   (requires a text index on the model)

  search(searchableFields = ['name']) {
    if (this.queryString.search) {
      // Escape special regex characters in the search term to prevent ReDoS
      const escaped = this.queryString.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex   = new RegExp(escaped, 'i');

      const conditions = searchableFields.map((field) => ({ [field]: regex }));
      this.query = this.query.find({ $or: conditions });
    }
    return this;
  }

  // ── sort ───────────────────────────────────────────────────────────────────
  // ?sort=-price,name  →  .sort('-price name')
  // Default: newest first (-createdAt)

  sort() {
    if (this.queryString.sort) {
      // Convert comma-separated fields to space-separated for Mongoose
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query   = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }
    return this;
  }

  // ── limitFields ────────────────────────────────────────────────────────────
  // ?fields=name,price,images  →  .select('name price images')
  // Always excludes __v; clients must explicitly request internal fields if allowed.

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query   = this.query.select(fields);
    } else {
      // Exclude __v by default — it's an internal Mongoose version key
      this.query = this.query.select('-__v');
    }
    return this;
  }

  // ── paginate ───────────────────────────────────────────────────────────────
  // ?page=2&limit=10  →  .skip(10).limit(10)
  // Stores page and limit on the instance so controllers can build meta.

  paginate() {
    this.page  = Math.max(1, parseInt(this.queryString.page)  || 1);
    this.limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(this.queryString.limit) || DEFAULT_PAGE_SIZE)
    );
    const skip  = (this.page - 1) * this.limit;
    this.query  = this.query.skip(skip).limit(this.limit);
    return this;
  }
}

module.exports = APIFeatures;