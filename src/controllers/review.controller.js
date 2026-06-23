'use strict';

/**
 * controllers/review.controller.js — Product Reviews
 * =====================================================
 */

const mongoose      = require('mongoose');
const Review        = require('../models/Review');
const Order         = require('../models/Order');
const uploadService  = require('../services/upload.service');
const asyncHandler   = require('../utils/asyncHandler');
const AppError       = require('../utils/AppError');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { getPaginationParams, buildPaginationMeta } = require('../utils/pagination');
const { MAX_REVIEW_IMAGES } = require('../utils/constants');

// ── getProductReviews ─────────────────────────────────────────────────────────

exports.getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.isValidObjectId(productId)) {
    throw new AppError('Invalid product ID.', 400);
  }

  const { page, limit, skip } = getPaginationParams(req.query);

  const sortOptions = {
    newest:  '-createdAt',
    highest: '-rating',
    liked:   '-likesCount',
  };
  const sortBy = sortOptions[req.query.sort] || '-createdAt';

  const [reviews, total, distribution] = await Promise.all([
    Review.find({ product: productId })
      .sort(sortBy)
      .skip(skip)
      .limit(limit)
      .populate('user', 'name avatar')
      .lean(),

    Review.countDocuments({ product: productId }),

    Review.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(productId) } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);

  // Shape distribution into { 1: N, 2: N, ... 5: N }
  const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribution.forEach((d) => { ratingDist[d._id] = d.count; });

  const averageRating =
    distribution.length > 0
      ? Math.round(
          (distribution.reduce((s, d) => s + d._id * d.count, 0) /
            distribution.reduce((s, d) => s + d.count, 0)) *
            10
        ) / 10
      : 0;

  paginatedResponse(
    res,
    reviews,
    {
      ...buildPaginationMeta(total, page, limit),
      ratingDistribution: ratingDist,
      averageRating,
    }
  );
});

// ── createReview ──────────────────────────────────────────────────────────────

exports.createReview = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.isValidObjectId(productId)) {
    throw new AppError('Invalid product ID.', 400);
  }

  // One review per user per product
  const existing = await Review.findOne({ product: productId, user: req.user._id });
  if (existing) throw new AppError('You have already reviewed this product.', 400);

  // Check verified purchase (user has a paid, delivered order containing this product)
  const isVerified = await Order.exists({
    user:           req.user._id,
    'items.product': productId,
    isPaid:          true,
    orderStatus:     'delivered',
  });

  let images = [];
  if (req.files && req.files.length > 0) {
    if (req.files.length > MAX_REVIEW_IMAGES) {
      throw new AppError(`Maximum ${MAX_REVIEW_IMAGES} images allowed per review.`, 400);
    }
    images = await uploadService.uploadMultipleImages(req.files, 'ecommerce/reviews');
  }

  const review = await Review.create({
    product:    productId,
    user:       req.user._id,
    rating:     req.body.rating,
    title:      req.body.title,
    comment:    req.body.comment,
    images,
    isVerified: Boolean(isVerified),
  });

  // post('save') hook on Review model auto-recalculates product rating average

  await review.populate('user', 'name avatar');

  createdResponse(res, { review }, 'Review submitted successfully.');
});

// ── updateReview ──────────────────────────────────────────────────────────────

exports.updateReview = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid review ID.', 400);
  }

  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found.', 404);

  // Ownership check (admins can also edit)
  if (
    req.user.role !== 'admin' &&
    review.user.toString() !== req.user._id.toString()
  ) {
    throw new AppError('You do not have permission to edit this review.', 403);
  }

  // Handle new images
  if (req.files && req.files.length > 0) {
    const currentCount = review.images.length;
    if (currentCount + req.files.length > MAX_REVIEW_IMAGES) {
      throw new AppError(`Maximum ${MAX_REVIEW_IMAGES} images per review.`, 400);
    }
    const newImages = await uploadService.uploadMultipleImages(req.files, 'ecommerce/reviews');
    review.images = [...review.images, ...newImages];
  }

  // Handle explicit image removal
  if (req.body.removeImages && Array.isArray(req.body.removeImages)) {
    uploadService.deleteMultipleImages(req.body.removeImages).catch(() => {});
    review.images = review.images.filter(
      (img) => !req.body.removeImages.includes(img.public_id)
    );
  }

  if (req.body.rating  !== undefined) review.rating  = req.body.rating;
  if (req.body.title   !== undefined) review.title   = req.body.title;
  if (req.body.comment !== undefined) review.comment = req.body.comment;

  await review.save(); // post-save hook recalculates average

  successResponse(res, { review }, 'Review updated.');
});

// ── deleteReview ──────────────────────────────────────────────────────────────

exports.deleteReview = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid review ID.', 400);
  }

  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found.', 404);

  if (
    req.user.role !== 'admin' &&
    review.user.toString() !== req.user._id.toString()
  ) {
    throw new AppError('You do not have permission to delete this review.', 403);
  }

  // Delete Cloudinary images
  const publicIds = review.images.map((img) => img.public_id).filter(Boolean);
  if (publicIds.length > 0) {
    uploadService.deleteMultipleImages(publicIds).catch(() => {});
  }

  await review.deleteOne(); // post('deleteOne') hook recalculates product rating

  successResponse(res, null, 'Review deleted.');
});

// ── likeReview ────────────────────────────────────────────────────────────────

exports.likeReview = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid review ID.', 400);
  }

  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found.', 404);

  const userId  = req.user._id;
  const hasLiked = review.likes.some((id) => id.toString() === userId.toString());

  const update = hasLiked
    ? { $pull:      { likes: userId } }
    : { $addToSet:  { likes: userId } };

  const updated = await Review.findByIdAndUpdate(req.params.id, update, { new: true });

  successResponse(res, {
    liked:     !hasLiked,
    likeCount: updated.likes.length,
  });
});