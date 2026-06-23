'use strict';

/**
 * models/Wishlist.js — Wishlist Schema & Model
 * ===============================================
 */

const mongoose = require('mongoose');
const { MAX_WISHLIST_ITEMS } = require('../utils/constants');

// ── WishlistSchema ────────────────────────────────────────────────────────────

const WishlistSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Wishlist must belong to a user.'],
      unique:   true, // One wishlist per user — enforced at DB level
    },

    products: {
      type:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

WishlistSchema.index({ user: 1 });

// Used by product.events.js → product.backInStock / product.priceDropped
// to find all users who have saved a specific product
WishlistSchema.index({ products: 1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────

WishlistSchema.virtual('count').get(function () {
  return this.products.length;
});

// ── Pre-save guard: cap wishlist size ────────────────────────────────────────
// Secondary guard — the primary check is in wishlist.controller before $addToSet.
// This ensures the limit is enforced even if the model is used directly.

WishlistSchema.pre('save', function (next) {
  if (this.products.length > MAX_WISHLIST_ITEMS) {
    const err = new Error(
      `Wishlist cannot exceed ${MAX_WISHLIST_ITEMS} items.`
    );
    err.statusCode = 400;
    return next(err);
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────

const Wishlist = mongoose.model('Wishlist', WishlistSchema);
module.exports = Wishlist;