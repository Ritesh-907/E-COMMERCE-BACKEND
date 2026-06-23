'use strict';

/**
 * models/Order.js — Order Schema & Model
 * =========================================
 * Prices and product details are ALWAYS snapshotted at order time —
 * never referenced live from the Product collection.
 */

const mongoose = require('mongoose');
const { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD } = require('../utils/enums');
const { generateOrderNumber }                          = require('../utils/helpers');

// ── OrderItemSchema ───────────────────────────────────────────────────────────

const OrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Product',
    },

    // Snapshots — never look these up from Product at display time
    name:     { type: String, required: true },
    image:    { type: String, default:  '' },
    price:    { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 }, // price × quantity
  },
  { _id: false }
);

// ── ShippingAddressSchema (snapshot — not a ref) ──────────────────────────────

const ShippingAddressSchema = new mongoose.Schema(
  {
    street:  { type: String, required: true },
    city:    { type: String, required: true },
    state:   { type: String, required: true },
    zip:     { type: String, required: true },
    country: { type: String, required: true },
    phone:   { type: String },
  },
  { _id: false }
);

// ── PaymentResultSchema ───────────────────────────────────────────────────────

const PaymentResultSchema = new mongoose.Schema(
  {
    id:            { type: String },  // Stripe PaymentIntent ID
    status:        { type: String },
    update_time:   { type: String },
    email_address: { type: String },
  },
  { _id: false }
);

// ── OrderSchema ───────────────────────────────────────────────────────────────

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type:   String,
      unique: true,
    },

    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Order must belong to a user.'],
    },

    items: {
      type:     [OrderItemSchema],
      required: true,
      validate: {
        validator: (items) => items.length > 0,
        message:   'Order must contain at least one item.',
      },
    },

    shippingAddress: {
      type:     ShippingAddressSchema,
      required: [true, 'Shipping address is required.'],
    },

    paymentMethod: {
      type:    String,
      enum:    Object.values(PAYMENT_METHOD),
      required: true,
    },

    paymentStatus: {
      type:    String,
      enum:    Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },

    paymentResult: {
      type:    PaymentResultSchema,
      default: null,
    },

    orderStatus: {
      type:    String,
      enum:    Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },

    // Pricing breakdown — all computed server-side, never trusted from client
    itemsPrice:     { type: Number, required: true, default: 0 },
    shippingPrice:  { type: Number, required: true, default: 0 },
    taxPrice:       { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, default: 0 },
    totalPrice:     { type: Number, required: true, default: 0 },

    // Coupon snapshot — code and discount amount at time of order
    coupon: {
      code:     { type: String },
      discount: { type: Number, default: 0 },
    },

    isPaid:       { type: Boolean, default: false },
    paidAt:       { type: Date },

    isDelivered:  { type: Boolean, default: false },
    deliveredAt:  { type: Date },

    trackingNumber: { type: String },
    notes:          { type: String, maxlength: 500 },
    cancelReason:   { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

OrderSchema.index({ user:        1, createdAt: -1 });
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ isPaid:      1, createdAt: -1 });
OrderSchema.index({ 'paymentResult.id': 1 }, { sparse: true }); // Webhook lookup

// ── Pre-save hook: generate order number ──────────────────────────────────────

OrderSchema.pre('save', function (next) {
  if (this.isNew && !this.orderNumber) {
    this.orderNumber = generateOrderNumber();
  }
  next();
});

// ── Virtuals ──────────────────────────────────────────────────────────────────

OrderSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// ─────────────────────────────────────────────────────────────────────────────

const Order = mongoose.model('Order', OrderSchema);
module.exports = Order;