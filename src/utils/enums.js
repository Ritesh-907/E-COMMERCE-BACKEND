'use strict';

/**
 * utils/enums.js — Application Enumerations
 * ============================================
 * Single source of truth for all enum values used in models,
 * controllers, validators, and middleware.
 *
 * Import from here instead of hardcoding strings like 'admin' or
 * 'pending' — typos become a load-time ReferenceError instead of a
 * silent runtime bug.
 */

// ── User roles ────────────────────────────────────────────────────────────────

const USER_ROLES = Object.freeze({
  USER:   'user',
  ADMIN:  'admin',
  SELLER: 'seller',
});

// ── Order status ──────────────────────────────────────────────────────────────

const ORDER_STATUS = Object.freeze({
  PENDING:    'pending',
  PROCESSING: 'processing',
  SHIPPED:    'shipped',
  DELIVERED:  'delivered',
  CANCELLED:  'cancelled',
});

// ── Valid order status state machine ─────────────────────────────────────────
// Used in order.controller.js → updateOrderStatus to prevent illegal transitions.

const VALID_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]:    [ORDER_STATUS.PROCESSING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PROCESSING]: [ORDER_STATUS.SHIPPED,    ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.SHIPPED]:    [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]:  [],
  [ORDER_STATUS.CANCELLED]:  [],
});

// ── Payment status ────────────────────────────────────────────────────────────

const PAYMENT_STATUS = Object.freeze({
  PENDING:  'pending',
  PAID:     'paid',
  FAILED:   'failed',
  REFUNDED: 'refunded',
});

// ── Payment method ────────────────────────────────────────────────────────────

const PAYMENT_METHOD = Object.freeze({
  CARD:   'card',
  COD:    'cod',    // Cash on Delivery
  WALLET: 'wallet',
});

// ── Coupon type ───────────────────────────────────────────────────────────────

const COUPON_TYPE = Object.freeze({
  PERCENTAGE: 'percentage',
  FIXED:      'fixed',
});

// ── Notification type ─────────────────────────────────────────────────────────

const NOTIFICATION_TYPE = Object.freeze({
  ORDER:  'order',   // Order status changes, payment confirmations
  PROMO:  'promo',   // Price drops, sale announcements
  SYSTEM: 'system',  // Account events, welcome messages
  REVIEW: 'review',  // Review replies, helpful votes
  STOCK:  'stock',   // Back-in-stock, low-stock admin alerts
});

// ── Review sort options ───────────────────────────────────────────────────────

const REVIEW_SORT = Object.freeze({
  NEWEST:  'newest',
  HIGHEST: 'highest',
  LIKED:   'liked',
});

// ── Storage provider ──────────────────────────────────────────────────────────

const STORAGE_PROVIDER = Object.freeze({
  CLOUDINARY: 'cloudinary',
  S3:         's3',
  LOCAL:      'local',
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  USER_ROLES,
  ORDER_STATUS,
  VALID_STATUS_TRANSITIONS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  COUPON_TYPE,
  NOTIFICATION_TYPE,
  REVIEW_SORT,
  STORAGE_PROVIDER,
};