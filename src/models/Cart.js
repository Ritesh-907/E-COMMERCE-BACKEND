'use strict';

/**
 * models/Cart.js — Cart Schema & Model
 * =======================================
 */

const mongoose = require('mongoose');

// ── CartItemSchema ────────────────────────────────────────────────────────────

const CartItemSchema = new mongoose.Schema(
  {
    product: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Product',
      required: [true, 'Product is required.'],
    },

    quantity: {
      type:     Number,
      required: [true, 'Quantity is required.'],
      min:      [1, 'Quantity must be at least 1.'],
      default:  1,
    },

    // Price snapshot at the time the item was added.
    // Synced against live price when cart is fetched (cart.controller getPopulatedCart).
    price: {
      type:     Number,
      required: [true, 'Price is required.'],
      min:      [0, 'Price cannot be negative.'],
    },
  },
  { _id: true } // Keep _id so individual items can be targeted by req.params.itemId
);

// ── CartSchema ────────────────────────────────────────────────────────────────

const CartSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Cart must belong to a user.'],
      unique:   true, // One cart per user enforced at DB level
    },

    items: {
      type:    [CartItemSchema],
      default: [],
    },

    // Applied coupon (null = no coupon)
    coupon: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Coupon',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── TTL index — auto-delete abandoned carts after 30 days ────────────────────
// updatedAt is used (not createdAt) so active carts are never expired.

CartSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
);

// ── Virtuals ──────────────────────────────────────────────────────────────────

CartSchema.virtual('totalItems').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

CartSchema.virtual('totalAmount').get(function () {
  return this.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
});

// ─────────────────────────────────────────────────────────────────────────────

const Cart = mongoose.model('Cart', CartSchema);
module.exports = Cart;