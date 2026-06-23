'use strict';

/**
 * models/Category.js — Category Schema & Model
 * ===============================================
 */

const mongoose = require('mongoose');
const slugify  = require('slugify');

// ── CategorySchema ────────────────────────────────────────────────────────────

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, 'Category name is required.'],
      unique:    true,
      trim:      true,
      maxlength: [100, 'Category name must not exceed 100 characters.'],
    },

    slug: {
      type:      String,
      unique:    true,
      lowercase: true,
    },

    // null = top-level category; ObjectId = sub-category of that parent
    parent: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Category',
      default: null,
    },

    image: {
      url:       { type: String, default: '' },
      public_id: { type: String, default: null },
    },

    isActive: { type: Boolean, default: true  },

    // Manual sort order for nav menu positioning (lower = first)
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

CategorySchema.index({ parent:   1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ order:    1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────

// Breadcrumb path — only meaningful when parent is populated
CategorySchema.virtual('path').get(function () {
  if (!this.parent || typeof this.parent === 'string') {
    return this.name;
  }
  // parent is populated (has a name property)
  const parentName = this.parent.name || '';
  return parentName ? `${parentName} > ${this.name}` : this.name;
});

// ── Pre-save hook: slug generation ────────────────────────────────────────────

CategorySchema.pre('save', async function (next) {
  if (!this.isModified('name')) return next();

  const base    = slugify(this.name, { lower: true, strict: true });
  let   slug    = base;
  let   counter = 1;
  const Category = mongoose.model('Category');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await Category.findOne({ slug, _id: { $ne: this._id } }).select('_id');
    if (!existing) break;
    slug = `${base}-${counter++}`;
  }

  this.slug = slug;
  next();
});

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * Fetch all active categories and build a nested tree structure.
 * Returns an array of top-level categories, each with a children array.
 *
 * @returns {Promise<object[]>}
 */
CategorySchema.statics.buildTree = async function () {
  const categories = await this.find({ isActive: true })
    .sort('order name')
    .lean();

  const map  = {};
  const tree = [];

  categories.forEach((cat) => {
    map[cat._id.toString()] = { ...cat, children: [] };
  });

  categories.forEach((cat) => {
    const parentId = cat.parent?.toString();
    if (parentId && map[parentId]) {
      map[parentId].children.push(map[cat._id.toString()]);
    } else {
      tree.push(map[cat._id.toString()]);
    }
  });

  return tree;
};

// ─────────────────────────────────────────────────────────────────────────────

const Category = mongoose.model('Category', CategorySchema);
module.exports = Category;