'use strict';

/**
 * controllers/category.controller.js — Category Management
 * ===========================================================
 */

const mongoose      = require('mongoose');
const Category      = require('../models/Category');
const Product       = require('../models/Product');
const uploadService  = require('../services/upload.service');
const cacheService   = require('../services/cache.service');
const asyncHandler   = require('../utils/asyncHandler');
const AppError       = require('../utils/AppError');
const { successResponse, createdResponse } = require('../utils/response');
const { CACHE_TTL } = require('../utils/constants');

const CATEGORIES_CACHE_KEY = 'categories:all';

// ── getAllCategories ───────────────────────────────────────────────────────────

exports.getAllCategories = asyncHandler(async (req, res) => {
  const { format } = req.query; // ?format=tree returns nested structure

  const categories = await cacheService.remember(
    CATEGORIES_CACHE_KEY,
    CACHE_TTL.CATEGORIES,
    () =>
      Category.find({ isActive: true })
        .populate('parent', 'name slug')
        .sort('order name')
        .lean()
  );

  if (format === 'tree') {
    const tree = buildTree(categories);
    return successResponse(res, { categories: tree });
  }

  successResponse(res, { categories });
});

// ── getCategoryById ────────────────────────────────────────────────────────────

exports.getCategoryById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const filter = mongoose.isValidObjectId(id)
    ? { _id: id }
    : { slug: id };

  const [category, productCount] = await Promise.all([
    Category.findOne(filter).populate('parent', 'name slug'),
    Product.countDocuments({
      category: mongoose.isValidObjectId(id) ? id : undefined,
      isPublished: true,
    }),
  ]);

  if (!category) throw new AppError('Category not found.', 404);

  successResponse(res, { category: { ...category.toObject(), productCount } });
});

// ── createCategory (admin) ────────────────────────────────────────────────────

exports.createCategory = asyncHandler(async (req, res) => {
  let image;

  if (req.file) {
    image = await uploadService.uploadImage(req.file.buffer, 'ecommerce/categories');
  }

  const category = await Category.create({
    ...req.body,
    ...(image && { image }),
  });

  await cacheService.del(CATEGORIES_CACHE_KEY);

  createdResponse(res, { category }, 'Category created successfully.');
});

// ── updateCategory (admin) ────────────────────────────────────────────────────

exports.updateCategory = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid category ID.', 400);
  }

  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError('Category not found.', 404);

  if (req.file) {
    // Delete old image from Cloudinary
    if (category.image?.public_id) {
      await uploadService.deleteImage(category.image.public_id).catch(() => {});
    }
    category.image = await uploadService.uploadImage(req.file.buffer, 'ecommerce/categories');
  }

  const allowed = ['name', 'parent', 'isActive', 'order'];
  allowed.forEach((f) => {
    if (req.body[f] !== undefined) category[f] = req.body[f];
  });

  await category.save(); // pre-save hook regenerates slug if name changed

  await cacheService.del(CATEGORIES_CACHE_KEY);

  successResponse(res, { category }, 'Category updated successfully.');
});

// ── deleteCategory (admin) ────────────────────────────────────────────────────

exports.deleteCategory = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid category ID.', 400);
  }

  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError('Category not found.', 404);

  // Guard: cannot delete if products are assigned
  const productCount = await Product.countDocuments({ category: req.params.id });
  if (productCount > 0) {
    throw new AppError(
      `Cannot delete category with ${productCount} assigned product(s). Reassign them first.`,
      400
    );
  }

  // Guard: cannot delete parent category
  const childCount = await Category.countDocuments({ parent: req.params.id });
  if (childCount > 0) {
    throw new AppError(
      `Cannot delete category with ${childCount} subcategory(s). Delete them first.`,
      400
    );
  }

  // Delete category image from Cloudinary
  if (category.image?.public_id) {
    await uploadService.deleteImage(category.image.public_id).catch(() => {});
  }

  await category.deleteOne();
  await cacheService.del(CATEGORIES_CACHE_KEY);

  successResponse(res, null, 'Category deleted successfully.');
});

// ── Helper: build nested category tree ───────────────────────────────────────

function buildTree(categories) {
  const map  = {};
  const tree = [];

  categories.forEach((cat) => {
    map[cat._id.toString()] = { ...cat, children: [] };
  });

  categories.forEach((cat) => {
    const parentId = cat.parent?._id?.toString() || cat.parent?.toString();
    if (parentId && map[parentId]) {
      map[parentId].children.push(map[cat._id.toString()]);
    } else {
      tree.push(map[cat._id.toString()]);
    }
  });

  return tree;
}