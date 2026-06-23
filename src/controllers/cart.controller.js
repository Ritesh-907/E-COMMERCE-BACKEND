'use strict';

/**
 * controllers/cart.controller.js — Shopping Cart
 * =================================================
 */

const Cart         = require('../models/Cart');
const Product      = require('../models/Product');
const couponService = require('../services/coupon.service');
const asyncHandler  = require('../utils/asyncHandler');
const AppError      = require('../utils/AppError');
const { successResponse } = require('../utils/response');

// ── Helper: get or create cart ────────────────────────────────────────────────

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });
  return cart;
}

// ── Helper: populate + validate cart ─────────────────────────────────────────
// Removes stale items and syncs prices against live DB values

async function getPopulatedCart(userId) {
  const cart = await Cart.findOne({ user: userId })
    .populate({ path: 'items.product', select: 'name price images stock isPublished slug' })
    .populate('coupon', 'code type discount');

  if (!cart) return null;

  let modified = false;

  // Remove items whose product was deleted or unpublished
  cart.items = cart.items.filter((item) => {
    if (!item.product || !item.product.isPublished) {
      modified = true;
      return false;
    }
    return true;
  });

  // Sync stored price with live price (price may have changed)
  cart.items.forEach((item) => {
    if (item.price !== item.product.price) {
      item.price = item.product.price;
      modified   = true;
    }
  });

  if (modified) await cart.save();
  return cart;
}

// ── getCart ───────────────────────────────────────────────────────────────────

exports.getCart = asyncHandler(async (req, res) => {
  const cart = await getPopulatedCart(req.user._id);

  if (!cart) {
    return successResponse(res, {
      cart:        { items: [], coupon: null },
      totalItems:  0,
      totalAmount: 0,
    });
  }

  const totalItems  = cart.totalItems;
  const totalAmount = cart.totalAmount;

  successResponse(res, { cart, totalItems, totalAmount });
});

// ── addToCart ─────────────────────────────────────────────────────────────────

exports.addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError('Quantity must be a positive integer.', 400);
  }

  const product = await Product.findById(productId);
  if (!product || !product.isPublished) {
    throw new AppError('Product not found or unavailable.', 404);
  }

  if (product.stock < quantity) {
    throw new AppError(
      `Insufficient stock. Only ${product.stock} unit(s) available.`,
      400
    );
  }

  const cart     = await getOrCreateCart(req.user._id);
  const existing = cart.items.find(
    (i) => i.product.toString() === productId
  );

  if (existing) {
    const newQty = existing.quantity + quantity;
    existing.quantity = Math.min(newQty, product.stock); // cap at stock
  } else {
    cart.items.push({
      product:  productId,
      quantity,
      price:    product.price,
    });
  }

  await cart.save();

  const populated = await getPopulatedCart(req.user._id);
  successResponse(res, {
    cart:        populated,
    totalItems:  populated.totalItems,
    totalAmount: populated.totalAmount,
  }, 'Item added to cart.');
});

// ── updateCartItem ────────────────────────────────────────────────────────────

exports.updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const { itemId }   = req.params;

  const cart = await getOrCreateCart(req.user._id);
  const item = cart.items.id(itemId);

  if (!item) throw new AppError('Item not found in cart.', 404);

  if (quantity === 0 || quantity === undefined) {
    cart.items.pull(itemId);
  } else {
    const product = await Product.findById(item.product).select('stock');
    if (quantity > (product?.stock || 0)) {
      throw new AppError(
        `Requested quantity exceeds available stock (${product?.stock || 0}).`,
        400
      );
    }
    item.quantity = quantity;
  }

  await cart.save();
  const populated = await getPopulatedCart(req.user._id);
  successResponse(res, { cart: populated, totalItems: populated.totalItems, totalAmount: populated.totalAmount });
});

// ── removeFromCart ────────────────────────────────────────────────────────────

exports.removeFromCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items.pull(req.params.itemId);
  await cart.save();

  const populated = await getPopulatedCart(req.user._id);
  successResponse(res, { cart: populated, totalItems: populated?.totalItems || 0, totalAmount: populated?.totalAmount || 0 }, 'Item removed from cart.');
});

// ── clearCart ─────────────────────────────────────────────────────────────────

exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items  = [];
  cart.coupon = null;
  await cart.save();
  successResponse(res, { cart }, 'Cart cleared.');
});

// ── applyCoupon ───────────────────────────────────────────────────────────────

exports.applyCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const cart      = await getPopulatedCart(req.user._id);

  if (!cart || cart.items.length === 0) {
    throw new AppError('Your cart is empty.', 400);
  }

  const cartTotal = cart.totalAmount;
  const result    = await couponService.validateAndApplyCoupon(code, req.user._id, cartTotal);

  if (!result.valid) throw new AppError(result.reason, 400);

  cart.coupon = result.coupon._id;
  await cart.save();

  successResponse(res, {
    discountAmount:    result.discountAmount,
    totalAfterDiscount: cartTotal - result.discountAmount,
    coupon:            { code: result.coupon.code, type: result.coupon.type, discount: result.coupon.discount },
  }, 'Coupon applied successfully.');
});

// ── removeCoupon ──────────────────────────────────────────────────────────────

exports.removeCoupon = asyncHandler(async (req, res) => {
  const cart  = await getOrCreateCart(req.user._id);
  cart.coupon = null;
  await cart.save();
  successResponse(res, null, 'Coupon removed.');
});