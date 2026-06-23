'use strict';

/**
 * models/Product.js — Product Schema & Model
 * =============================================
 */

const mongoose = require('mongoose');
const slugify  = require('slugify');

// ── ImageSchema ───────────────────────────────────────────────────────────────

const ImageSchema = new mongoose.Schema(
  {
    url:       { type: String, required: true },
    public_id: { type: String, default: null },
  },
  { _id: false }
);

// ── ProductSchema ─────────────────────────────────────────────────────────────

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, 'Product name is required.'],
      trim:      true,
      minlength: [3,   'Product name must be at least 3 characters.'],
      maxlength: [200, 'Product name must not exceed 200 characters.'],
    },

    slug: {
      type:      String,
      unique:    true,
      lowercase: true,
    },

    description: {
      type:      String,
      required:  [true, 'Description is required.'],
      minlength: [20,   'Description must be at least 20 characters.'],
      maxlength: [5000, 'Description must not exceed 5000 characters.'],
    },

    shortDesc: {
      type:      String,
      maxlength: [200, 'Short description must not exceed 200 characters.'],
    },

    price: {
      type:     Number,
      required: [true, 'Price is required.'],
      min:      [0, 'Price cannot be negative.'],
    },

    // Original / compare price for "was $X" display
    comparePrice: {
      type:    Number,
      min:     [0, 'Compare price cannot be negative.'],
      default: null,
    },

    category: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Category',
      required: [true, 'Category is required.'],
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },

    images: {
      type:    [ImageSchema],
      default: [],
    },

    stock: {
      type:    Number,
      default: 0,
      min:     [0, 'Stock cannot be negative.'],
    },

    // Cumulative units sold — incremented by order.service on each purchase
    sold: {
      type:    Number,
      default: 0,
    },

    sku: {
      type:   String,
      unique: true,
      sparse: true, // Allows multiple null values; unique among non-null
      trim:   true,
      uppercase: true,
    },

    brand: {
      type:      String,
      trim:      true,
      maxlength: [100, 'Brand must not exceed 100 characters.'],
    },

    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count:   { type: Number, default: 0 },
    },

    // Flexible key-value store for product-specific attributes
    // e.g. { color: 'Red', size: 'XL', weight: '0.5kg' }
    attributes: {
      type:    Map,
      of:      mongoose.Schema.Types.Mixed,
      default: {},
    },

    tags: {
      type:    [String],
      default: [],
    },

    views: {
      type:    Number,
      default: 0,
    },

    isFeatured:  { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Text index for full-text search across name, description, and brand
ProductSchema.index(
  { name: 'text', description: 'text', brand: 'text' },
  { weights: { name: 10, brand: 5, description: 1 } }
);

ProductSchema.index({ category:    1, isPublished: 1 });
ProductSchema.index({ isFeatured:  1, isPublished: 1 });
ProductSchema.index({ seller:      1 });
ProductSchema.index({ price:       1 });
ProductSchema.index({ 'ratings.average': -1 });
ProductSchema.index({ createdAt:   -1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────

ProductSchema.virtual('discountPercent').get(function () {
  if (this.comparePrice && this.comparePrice > this.price) {
    return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
  }
  return 0;
});

ProductSchema.virtual('inStock').get(function () {
  return this.stock > 0;
});

// ── Pre-save hook: slug generation ────────────────────────────────────────────

ProductSchema.pre('save', async function (next) {
  if (!this.isModified('name')) return next();

  const base = slugify(this.name, { lower: true, strict: true });

  // Ensure slug uniqueness by appending an incrementing suffix if needed
  let slug       = base;
  let counter    = 1;
  const Product  = mongoose.model('Product'); // Avoid circular ref at module load

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await Product.findOne({ slug, _id: { $ne: this._id } }).select('_id');
    if (!existing) break;
    slug = `${base}-${counter++}`;
  }

  this.slug = slug;
  next();
});

// ─────────────────────────────────────────────────────────────────────────────

const Product = mongoose.model('Product', ProductSchema);
module.exports = Product;