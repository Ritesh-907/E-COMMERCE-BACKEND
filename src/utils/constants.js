'use strict';

/**
 * utils/constants.js — Application-Wide Constants
 * ==================================================
 * Single source of truth for every magic number and configuration value.
 * All environment-overridable values use process.env with a sensible fallback.
 *
 * Import from here instead of hardcoding numbers in controllers / services:
 *   const { TAX_RATE, CACHE_TTL } = require('../utils/constants')
 */

// ── Pricing ───────────────────────────────────────────────────────────────────

const TAX_RATE                = parseFloat(process.env.TAX_RATE)                || 0.10;  // 10 %
const FREE_SHIPPING_THRESHOLD = parseFloat(process.env.FREE_SHIPPING_THRESHOLD) || 500;   // USD
const SHIPPING_COST           = parseFloat(process.env.SHIPPING_COST)           || 10;    // USD flat rate

// ── Cart & Wishlist ───────────────────────────────────────────────────────────

const MAX_CART_ITEMS     = parseInt(process.env.MAX_CART_ITEMS)     || 50;
const MAX_WISHLIST_ITEMS = parseInt(process.env.MAX_WISHLIST_ITEMS) || 100;

// ── Products ──────────────────────────────────────────────────────────────────

const MAX_PRODUCT_IMAGES  = parseInt(process.env.MAX_PRODUCT_IMAGES)  || 5;
const MAX_REVIEW_IMAGES   = parseInt(process.env.MAX_REVIEW_IMAGES)   || 3;
const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD) || 5;  // Alert when stock <= this

// ── Pagination ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = parseInt(process.env.DEFAULT_PAGE_SIZE) || 20;
const MAX_PAGE_SIZE     = parseInt(process.env.MAX_PAGE_SIZE)     || 100;

// ── Token expiry (milliseconds, used by User model methods) ──────────────────

const PASSWORD_RESET_EXPIRE = 10 * 60 * 1000;          // 10 minutes
const EMAIL_VERIFY_EXPIRE   = 24 * 60 * 60 * 1000;     // 24 hours

// ── Redis cache TTL (seconds) ─────────────────────────────────────────────────

const CACHE_TTL = Object.freeze({
  PRODUCTS:     300,    //  5 minutes — product listings change on stock/price updates
  CATEGORIES:   3600,   //  1 hour    — categories change rarely
  FEATURED:     3600,   //  1 hour    — featured products update infrequently
  ANALYTICS:    300,    //  5 minutes — dashboard stats pre-computed by analytics.job
  USER_SESSION: 900,    // 15 minutes — per-user cached data (cart summary, etc.)
});

// ── Upload limits ─────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_FILE_SIZE_MB || '5') * 1024 * 1024; // Default 5 MB

// ── Security ──────────────────────────────────────────────────────────────────

const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;

// ── Order number prefix ───────────────────────────────────────────────────────

const ORDER_NUMBER_PREFIX = process.env.ORDER_NUMBER_PREFIX || 'ORD';

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Pricing
  TAX_RATE,
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_COST,

  // Cart & Wishlist
  MAX_CART_ITEMS,
  MAX_WISHLIST_ITEMS,

  // Products
  MAX_PRODUCT_IMAGES,
  MAX_REVIEW_IMAGES,
  LOW_STOCK_THRESHOLD,

  // Pagination
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,

  // Token expiry
  PASSWORD_RESET_EXPIRE,
  EMAIL_VERIFY_EXPIRE,

  // Cache TTL
  CACHE_TTL,

  // Upload
  MAX_FILE_SIZE_BYTES,

  // Security
  BCRYPT_SALT_ROUNDS,
  MAX_LOGIN_ATTEMPTS,

  // Orders
  ORDER_NUMBER_PREFIX,
};