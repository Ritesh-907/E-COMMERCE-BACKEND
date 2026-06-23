'use strict';

/**
 * controllers/wishlist.controller.js — Wishlist Management
 * ===========================================================
 */

const mongoose     = require('mongoose');
const Wishlist     = require('../models/Wishlist');
const Product      = require('../models/Product');
const Cart         = require('../models/Cart');
const asyncHandler = require('../utils/asyncHandler');
const AppError     = require('../utils/AppError');
const { successResponse } = require('../utils/response');
const { MAX_WISHLIST_ITEMS } = require('../utils/constants');

// ── getWishlist ───────────────────────────────────────────────────────────────

exports.getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id }).populate({
    path:   'products',
    select: 'name price comparePrice images stock ratings isPublished slug',
  });

  if (!wishlist) {
    return successResponse(res, { wishlist: { products: [] }, count: 0 });
  }

  // Filter out unpublished / deleted products from the populated list
  wishlist.products = wishlist.products.filter((p) => p && p.isPublished);

  successResponse(res, { wishlist, count: wishlist.products.length });
});

// ── addToWishlist ─────────────────────────────────────────────────────────────

exports.addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!mongoose.isValidObjectId(productId)) {
    throw new AppError('Invalid product ID.', 400);
  }

  const product = await Product.findById(productId).select('_id isPublished');
  if (!product || !product.isPublished) {
    throw new AppError('Product not found or unavailable.', 404);
  }

  // Enforce wishlist size cap before $addToSet
  const existing = await Wishlist.findOne({ user: req.user._id }).select('products');
  if (existing && existing.products.length >= MAX_WISHLIST_ITEMS) {
    throw new AppError(
      `Wishlist is full. Maximum ${MAX_WISHLIST_ITEMS} items allowed.`,
      400
    );
  }

  await Wishlist.findOneAndUpdate(
    { user: req.user._id },
    { $addToSet: { products: productId } },
    { upsert: true, new: true }
  );

  successResponse(res, null, 'Product added to wishlist.');
});

// ── removeFromWishlist ────────────────────────────────────────────────────────

exports.removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.isValidObjectId(productId)) {
    throw new AppError('Invalid product ID.', 400);
  }

  await Wishlist.findOneAndUpdate(
    { user: req.user._id },
    { $pull: { products: productId } },
    { new: true }
  );

  successResponse(res, null, 'Product removed from wishlist.');
});

// ── moveToCart ────────────────────────────────────────────────────────────────

exports.moveToCart = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.isValidObjectId(productId)) {
    throw new AppError('Invalid product ID.', 400);
  }

  const product = await Product.findById(productId);
  if (!product || !product.isPublished) {
    throw new AppError('Product not found or unavailable.', 404);
  }

  if (product.stock < 1) {
    throw new AppError('This product is currently out of stock.', 400);
  }

  // Add to cart (upsert pattern matching cart.controller logic)
  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = new Cart({ user: req.user._id, items: [] });

  const existingItem = cart.items.find(
    (i) => i.product.toString() === productId
  );

  if (existingItem) {
    existingItem.quantity = Math.min(existingItem.quantity + 1, product.stock);
  } else {
    cart.items.push({ product: productId, quantity: 1, price: product.price });
  }

  // Remove from wishlist and save cart atomically-ish (no session needed here)
  await Promise.all([
    cart.save(),
    Wishlist.findOneAndUpdate(
      { user: req.user._id },
      { $pull: { products: productId } }
    ),
  ]);

  successResponse(res, null, 'Product moved to cart.');
});