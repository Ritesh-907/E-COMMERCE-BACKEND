'use strict';

/**
 * controllers/product.controller.js — Product CRUD & Catalog
 * =============================================================
 */

const mongoose     = require('mongoose');
const Product      = require('../models/Product');
const Review       = require('../models/Review');
const uploadService  = require('../services/upload.service');
const cacheService   = require('../services/cache.service');
const asyncHandler   = require('../utils/asyncHandler');
const AppError       = require('../utils/AppError');
const APIFeatures    = require('../utils/apiFeatures');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { getPaginationParams, buildPaginationMeta } = require('../utils/pagination');
const { CACHE_TTL, MAX_PRODUCT_IMAGES } = require('../utils/constants');

const PRODUCT_CACHE_PATTERN = 'cache:/api/v1/products*';

// ── getAllProducts ────────────────────────────────────────────────────────────

exports.getAllProducts = asyncHandler(async (req, res) => {
  const baseFilter = { isPublished: true };

  const features = new APIFeatures(Product.find(baseFilter), req.query)
    .filter()
    .search(['name', 'brand', 'description'])
    .sort()
    .limitFields()
    .paginate();

  const [products, total] = await Promise.all([
    features.query.populate('category', 'name slug').lean(),
    Product.countDocuments({ ...baseFilter, ...features.query.getFilter() }),
  ]);

  paginatedResponse(
    res,
    products,
    buildPaginationMeta(total, features.page, features.limit)
  );
});

// ── getProductById ────────────────────────────────────────────────────────────

exports.getProductById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Support lookup by MongoDB ObjectId OR slug
  const filter = mongoose.isValidObjectId(id)
    ? { _id: id, isPublished: true }
    : { slug: id, isPublished: true };

  const product = await Product.findOne(filter)
    .populate('category', 'name slug')
    .populate('seller', 'name avatar');

  if (!product) throw new AppError('Product not found.', 404);

  // Increment view count asynchronously — don't await
  Product.findByIdAndUpdate(product._id, { $inc: { views: 1 } }).exec();

  // Fetch 3 most recent reviews as a preview
  const recentReviews = await Review.find({ product: product._id })
    .sort('-createdAt')
    .limit(3)
    .populate('user', 'name avatar')
    .lean();

  successResponse(res, { product, recentReviews });
});

// ── createProduct ─────────────────────────────────────────────────────────────

exports.createProduct = asyncHandler(async (req, res) => {
  let images = [];

  if (req.files && req.files.length > 0) {
    if (req.files.length > MAX_PRODUCT_IMAGES) {
      throw new AppError(`You can upload a maximum of ${MAX_PRODUCT_IMAGES} images.`, 400);
    }
    images = await uploadService.uploadMultipleImages(req.files, 'ecommerce/products');
  }

  const product = await Product.create({
    ...req.body,
    images,
    seller: req.user._id,
  });

  await cacheService.flush(PRODUCT_CACHE_PATTERN);

  createdResponse(res, { product }, 'Product created successfully.');
});

// ── updateProduct ─────────────────────────────────────────────────────────────

exports.updateProduct = asyncHandler(async (req, res) => {
  // req.resource is set by checkOwnership middleware to avoid an extra DB fetch
  const product = req.resource || await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found.', 404);

  // Handle new image uploads
  if (req.files && req.files.length > 0) {
    const currentCount = product.images.length;
    const newCount     = req.files.length;

    if (currentCount + newCount > MAX_PRODUCT_IMAGES) {
      throw new AppError(
        `Adding ${newCount} image(s) would exceed the ${MAX_PRODUCT_IMAGES}-image limit. Remove some first.`,
        400
      );
    }

    const newImages = await uploadService.uploadMultipleImages(req.files, 'ecommerce/products');
    product.images  = [...product.images, ...newImages];
  }

  // Handle explicit image removals (array of public_ids from client)
  if (req.body.removeImages && Array.isArray(req.body.removeImages)) {
    const toRemove = req.body.removeImages;

    // Delete from Cloudinary (non-blocking)
    uploadService.deleteMultipleImages(toRemove).catch(() => {});

    product.images = product.images.filter(
      (img) => !toRemove.includes(img.public_id)
    );

    delete req.body.removeImages; // don't let it overwrite the computed images array
  }

  // Apply scalar field updates (slug regenerates in pre-save if name changed)
  const allowedFields = [
    'name', 'description', 'shortDesc', 'price', 'comparePrice',
    'category', 'stock', 'sku', 'brand', 'attributes', 'tags',
    'isFeatured', 'isPublished',
  ];
  allowedFields.forEach((f) => {
    if (req.body[f] !== undefined) product[f] = req.body[f];
  });

  await product.save();
  await cacheService.flush(PRODUCT_CACHE_PATTERN);

  successResponse(res, { product }, 'Product updated successfully.');
});

// ── deleteProduct ─────────────────────────────────────────────────────────────

exports.deleteProduct = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid product ID.', 400);
  }

  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found.', 404);

  // Delete all Cloudinary images (non-blocking)
  const publicIds = product.images
    .map((img) => img.public_id)
    .filter(Boolean);

  if (publicIds.length > 0) {
    uploadService.deleteMultipleImages(publicIds).catch(() => {});
  }

  // Delete reviews and the product in parallel
  await Promise.all([
    Review.deleteMany({ product: product._id }),
    product.deleteOne(),
  ]);

  await cacheService.flush(PRODUCT_CACHE_PATTERN);

  successResponse(res, null, 'Product deleted successfully.');
});

// ── getFeaturedProducts ───────────────────────────────────────────────────────

exports.getFeaturedProducts = asyncHandler(async (req, res) => {
  const cacheKey = 'cache:featured-products';

  const cached = await cacheService.get(cacheKey);
  if (cached) return successResponse(res, { products: cached });

  const products = await Product.find({ isFeatured: true, isPublished: true })
    .limit(10)
    .populate('category', 'name slug')
    .lean();

  await cacheService.set(cacheKey, products, CACHE_TTL.FEATURED);
  successResponse(res, { products });
});

// ── getRelatedProducts ────────────────────────────────────────────────────────

exports.getRelatedProducts = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid product ID.', 400);
  }

  const product = await Product.findById(req.params.id).select('category');
  if (!product) throw new AppError('Product not found.', 404);

  const related = await Product.find({
    category:    product.category,
    _id:         { $ne: product._id },
    isPublished: true,
  })
    .limit(6)
    .select('name price comparePrice images ratings slug')
    .lean();

  successResponse(res, { products: related });
});