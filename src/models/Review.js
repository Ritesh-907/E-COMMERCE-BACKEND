'use strict';

/**
 * models/Review.js — Review Schema & Model
 * ===========================================
 */

const mongoose = require('mongoose');

// ── ReviewSchema ──────────────────────────────────────────────────────────────

const ReviewSchema = new mongoose.Schema(
  {
    product: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Product',
      required: [true, 'Review must belong to a product.'],
    },

    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Review must belong to a user.'],
    },

    rating: {
      type:     Number,
      required: [true, 'Rating is required.'],
      min:      [1, 'Rating must be at least 1 star.'],
      max:      [5, 'Rating cannot exceed 5 stars.'],
    },

    title: {
      type:      String,
      trim:      true,
      maxlength: [100, 'Title must not exceed 100 characters.'],
    },

    comment: {
      type:      String,
      required:  [true, 'A comment is required.'],
      trim:      true,
      minlength: [10,   'Comment must be at least 10 characters.'],
      maxlength: [1000, 'Comment must not exceed 1000 characters.'],
    },

    images: {
      type:    [{ url: String, public_id: { type: String, default: null } }],
      default: [],
    },

    // True when the reviewer has a paid, delivered order containing this product.
    // Set by review.controller at creation time.
    isVerified: { type: Boolean, default: false },

    // Array of user IDs who liked this review (for "X people found this helpful")
    likes: {
      type:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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

// Compound unique: one review per user per product, enforced at DB level
ReviewSchema.index({ product: 1, user: 1 }, { unique: true });
ReviewSchema.index({ product: 1, createdAt: -1 });
ReviewSchema.index({ product: 1, rating:    -1 }); // For "highest rated first" sort

// ── Virtuals ──────────────────────────────────────────────────────────────────

ReviewSchema.virtual('likesCount').get(function () {
  return this.likes.length;
});

// ── Static: calcAverageRatings ────────────────────────────────────────────────

/**
 * Recalculate and persist the average rating + review count for a product.
 * Called automatically by post-save and post-deleteOne hooks.
 *
 * @param {mongoose.Types.ObjectId} productId
 */
ReviewSchema.statics.calcAverageRatings = async function (productId) {
  const result = await this.aggregate([
    { $match: { product: productId } },
    {
      $group: {
        _id:     '$product',
        average: { $avg: '$rating' },
        count:   { $sum: 1 },
      },
    },
  ]);

  const average = result.length > 0
    ? Math.round(result[0].average * 10) / 10  // Round to 1 decimal place
    : 0;
  const count   = result.length > 0 ? result[0].count : 0;

  // Use mongoose.model to avoid circular-reference issues at module load
  await mongoose.model('Product').findByIdAndUpdate(productId, {
    'ratings.average': average,
    'ratings.count':   count,
  });
};

// ── Post-save hook: recalculate ratings ──────────────────────────────────────

ReviewSchema.post('save', async function () {
  // `this.constructor` is the Review model — avoids circular require()
  await this.constructor.calcAverageRatings(this.product);
});

// ── Post-deleteOne hook: recalculate ratings ──────────────────────────────────
// { document: true } ensures the hook runs on document.deleteOne(), not
// Model.deleteOne() query middleware (which has a different `this` context).

ReviewSchema.post('deleteOne', { document: true, query: false }, async function () {
  await this.constructor.calcAverageRatings(this.product);
});

// ─────────────────────────────────────────────────────────────────────────────

const Review = mongoose.model('Review', ReviewSchema);
module.exports = Review;