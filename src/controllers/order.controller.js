'use strict';

/**
 * controllers/order.controller.js — Order Management
 * =====================================================
 */

const mongoose      = require('mongoose');
const Order         = require('../models/Order');
const Cart          = require('../models/Cart');
const orderService  = require('../services/order.service');
const couponService = require('../services/coupon.service');
const paymentService = require('../services/payment.service');
const asyncHandler  = require('../utils/asyncHandler');
const AppError      = require('../utils/AppError');
const APIFeatures   = require('../utils/apiFeatures');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { getPaginationParams, buildPaginationMeta } = require('../utils/pagination');
const { ORDER_STATUS, VALID_STATUS_TRANSITIONS } = require('../utils/enums');
const logger        = require('../utils/logger');

// Lazy-load event emitter to avoid circular deps at module load time
const getOrderEmitter = () => require('../events/order.events');

// ── createOrder ───────────────────────────────────────────────────────────────

exports.createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, paymentMethod, couponCode, notes } = req.body;

  if (!items || items.length === 0) {
    throw new AppError('Order must contain at least one item.', 400);
  }

  // Validate stock and build product-enriched item list
  const { valid, outOfStock, products } = await orderService.validateStock(items);
  if (!valid) {
    throw new AppError(
      `The following items are unavailable: ${outOfStock.map((i) => i.name).join(', ')}`,
      400,
      outOfStock
    );
  }

  const orderItems = orderService.buildOrderItems(items, products);

  // Coupon validation (optional)
  let couponDoc    = null;
  let couponMeta   = null;
  if (couponCode) {
    const itemsSubtotal = orderItems.reduce((s, i) => s + i.subtotal, 0);
    const result = await couponService.validateAndApplyCoupon(
      couponCode,
      req.user._id,
      itemsSubtotal
    );
    if (!result.valid) throw new AppError(result.reason, 400);
    couponDoc  = result.coupon;
    couponMeta = { code: couponDoc.code, discount: result.discountAmount };
  }

  // Calculate final totals (all server-side — never trust client prices)
  const totals = orderService.calculateOrderTotals(
    items.map((item, i) => ({ product: products[i], quantity: item.quantity })),
    couponDoc,
    shippingAddress
  );

  // Mongoose session for atomicity: stock decrement + order creation + cart clear
  const session = await mongoose.startSession();
  let order;

  try {
    await session.withTransaction(async () => {
      await orderService.decrementStock(orderItems, session);

      const [created] = await Order.create(
        [
          {
            user:            req.user._id,
            items:           orderItems,
            shippingAddress,
            paymentMethod,
            notes,
            coupon:          couponMeta,
            ...totals,
          },
        ],
        { session }
      );

      order = created;

      // Clear the cart atomically
      await Cart.findOneAndDelete({ user: req.user._id }, { session });

      // Mark coupon as used (only after order is confirmed)
      if (couponDoc) {
        await couponService.markCouponUsed(couponDoc._id, req.user._id);
      }
    });
  } finally {
    session.endSession();
  }

  logger.info('Order created', { orderId: order._id, userId: req.user._id });

  // Emit event for confirmation email, notification, etc.
  getOrderEmitter().emit('order.created', { order, user: req.user });

  createdResponse(res, { order }, 'Order placed successfully.');
});

// ── getUserOrders ─────────────────────────────────────────────────────────────

exports.getUserOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query);

  const filter = { user: req.user._id };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('items.product', 'name images slug')
      .lean(),
    Order.countDocuments(filter),
  ]);

  paginatedResponse(res, orders, buildPaginationMeta(total, page, limit));
});

// ── getOrderById ──────────────────────────────────────────────────────────────

exports.getOrderById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid order ID.', 400);
  }

  const order = await Order.findById(req.params.id)
    .populate('user', 'name email')
    .populate('items.product', 'name images slug');

  if (!order) throw new AppError('Order not found.', 404);

  // Non-admins can only view their own orders
  if (
    req.user.role !== 'admin' &&
    order.user._id.toString() !== req.user._id.toString()
  ) {
    throw new AppError('You do not have permission to view this order.', 403);
  }

  successResponse(res, { order });
});

// ── cancelOrder ───────────────────────────────────────────────────────────────

exports.cancelOrder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid order ID.', 400);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found.', 404);

  // Ownership check
  if (
    req.user.role !== 'admin' &&
    order.user.toString() !== req.user._id.toString()
  ) {
    throw new AppError('You do not have permission to cancel this order.', 403);
  }

  const cancellableStatuses = [ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING];
  if (!cancellableStatuses.includes(order.orderStatus)) {
    throw new AppError(
      `Orders with status "${order.orderStatus}" cannot be cancelled.`,
      400
    );
  }

  // Restore stock
  await orderService.restoreStock(order.items);

  // Refund if already paid (e.g. COD not yet paid, but card may be)
  if (order.isPaid && order.paymentResult?.id) {
    try {
      await paymentService.refundPayment(order.paymentResult.id);
      order.paymentStatus = 'refunded';
    } catch (err) {
      logger.error('Refund failed during cancellation', {
        orderId: order._id,
        error:   err.message,
      });
      // Don't block the cancellation — flag for manual review
    }
  }

  order.orderStatus  = ORDER_STATUS.CANCELLED;
  order.cancelReason = req.body.reason || 'Cancelled by customer';
  await order.save();

  getOrderEmitter().emit('order.cancelled', { order, user: req.user });

  successResponse(res, { order }, 'Order cancelled successfully.');
});

// ── Admin: getAllOrders ───────────────────────────────────────────────────────

exports.getAllOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query);

  const features = new APIFeatures(Order.find(), req.query)
    .filter()
    .sort()
    .paginate();

  const [orders, total, stats] = await Promise.all([
    Order.find(features.query.getFilter())
      .sort(req.query.sort ? req.query.sort.split(',').join(' ') : '-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email')
      .lean(),
    Order.countDocuments(features.query.getFilter()),
    // Summary stats in the same round-trip
    Order.aggregate([
      {
        $group: {
          _id:          '$orderStatus',
          count:        { $sum: 1 },
          totalRevenue: { $sum: { $cond: ['$isPaid', '$totalPrice', 0] } },
        },
      },
    ]),
  ]);

  paginatedResponse(res, orders, {
    ...buildPaginationMeta(total, page, limit),
    stats,
  });
});

// ── Admin: updateOrderStatus ──────────────────────────────────────────────────

exports.updateOrderStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid order ID.', 400);
  }

  const { status } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found.', 404);

  // Validate state machine transition
  const allowedNext = VALID_STATUS_TRANSITIONS[order.orderStatus] || [];
  if (!allowedNext.includes(status)) {
    throw new AppError(
      `Cannot transition from "${order.orderStatus}" to "${status}". Allowed: ${allowedNext.join(', ') || 'none'}.`,
      400
    );
  }

  order.orderStatus = status;

  if (status === ORDER_STATUS.DELIVERED) {
    order.isDelivered  = true;
    order.deliveredAt  = Date.now();
  }

  await order.save();

  getOrderEmitter().emit('order.statusUpdated', { order });

  successResponse(res, { order }, `Order status updated to "${status}".`);
});

// ── Admin: addTrackingNumber ──────────────────────────────────────────────────

exports.addTrackingNumber = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid order ID.', 400);
  }

  const { trackingNumber, autoShip = true } = req.body;

  if (!trackingNumber) throw new AppError('Tracking number is required.', 400);

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found.', 404);

  order.trackingNumber = trackingNumber;

  // Automatically advance status to shipped if still processing
  if (autoShip && order.orderStatus === ORDER_STATUS.PROCESSING) {
    order.orderStatus = ORDER_STATUS.SHIPPED;
    getOrderEmitter().emit('order.statusUpdated', { order });
  }

  await order.save();

  successResponse(res, { order }, 'Tracking number added.');
});