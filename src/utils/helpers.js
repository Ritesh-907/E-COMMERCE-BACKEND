'use strict';

/**
 * utils/helpers.js — General-Purpose Helper Functions
 * ======================================================
 * Small, pure utility functions with no side effects.
 * No imports from services, models, or DB — keeps them fully testable.
 */

const mongoose = require('mongoose');
const { ORDER_NUMBER_PREFIX } = require('./constants');

// ── slugify ───────────────────────────────────────────────────────────────────

/**
 * Convert a string to a URL-friendly slug.
 * 'Hello World! (Sale)' → 'hello-world-sale'
 *
 * @param  {string} text
 * @returns {string}
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')                        // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '')         // Strip accent marks
    .replace(/[^a-z0-9\s-]/g, '')           // Remove all non-alphanumeric (keep spaces & hyphens)
    .replace(/\s+/g, '-')                   // Replace whitespace with hyphens
    .replace(/-+/g, '-')                    // Collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');              // Trim leading/trailing hyphens
}

// ── generateOrderNumber ───────────────────────────────────────────────────────

/**
 * Generate a human-readable order number.
 * Uses a timestamp suffix for uniqueness.
 * Format: ORD-2024-000001 (timestamp-based counter approximation)
 *
 * @returns {string}  e.g. 'ORD-1715000000000'
 */
function generateOrderNumber() {
  return `${ORDER_NUMBER_PREFIX}-${Date.now()}`;
}

// ── formatCurrency ────────────────────────────────────────────────────────────

/**
 * Format a number as a currency string using the Intl API.
 *
 * @param  {number} amount
 * @param  {string} [currency='USD']
 * @param  {string} [locale='en-US']
 * @returns {string}  e.g. '$1,234.56'
 */
function formatCurrency(amount, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    style:                 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ── pickFields ────────────────────────────────────────────────────────────────

/**
 * Return a new object containing only the specified keys.
 * Undefined keys are silently skipped.
 *
 * @param  {object}   obj
 * @param  {string[]} fields
 * @returns {object}
 */
function pickFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return {};
  return fields.reduce((acc, key) => {
    if (obj[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});
}

// ── omitFields ────────────────────────────────────────────────────────────────

/**
 * Return a new object with the specified keys removed.
 * Useful for stripping sensitive fields before sending to the client.
 *
 * @param  {object}   obj
 * @param  {string[]} fields
 * @returns {object}
 */
function omitFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return {};
  const set = new Set(fields);
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !set.has(k))
  );
}

// ── isValidObjectId ───────────────────────────────────────────────────────────

/**
 * Check whether a string is a valid MongoDB ObjectId.
 *
 * @param  {*} id
 * @returns {boolean}
 */
function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}

// ── sleep ─────────────────────────────────────────────────────────────────────

/**
 * Pause execution for a given number of milliseconds.
 * Useful for retry loops and test fixtures.
 *
 * @param  {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── capitalizeFirst ───────────────────────────────────────────────────────────

/**
 * Capitalise the first character of a string.
 *
 * @param  {string} str
 * @returns {string}
 */
function capitalizeFirst(str) {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── roundToTwo ────────────────────────────────────────────────────────────────

/**
 * Round a number to 2 decimal places — avoids floating-point drift in price calcs.
 * e.g.  0.1 + 0.2  → 0.30 (not 0.30000000000000004)
 *
 * @param  {number} num
 * @returns {number}
 */
function roundToTwo(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

// ── chunkArray ────────────────────────────────────────────────────────────────

/**
 * Split an array into chunks of a given size.
 * Useful for batching DB operations or email sends.
 *
 * @param  {Array}  arr
 * @param  {number} size
 * @returns {Array[]}
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── deepFreeze ────────────────────────────────────────────────────────────────

/**
 * Recursively freeze an object so it cannot be mutated at runtime.
 * Used in constants.js and enums.js.
 *
 * @param  {object} obj
 * @returns {object}
 */
function deepFreeze(obj) {
  Object.getOwnPropertyNames(obj).forEach((name) => {
    const value = obj[name];
    if (value && typeof value === 'object') deepFreeze(value);
  });
  return Object.freeze(obj);
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  slugify,
  generateOrderNumber,
  formatCurrency,
  pickFields,
  omitFields,
  isValidObjectId,
  sleep,
  capitalizeFirst,
  roundToTwo,
  chunkArray,
  deepFreeze,
};