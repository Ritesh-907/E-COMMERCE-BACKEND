'use strict';

/**
 * middleware/ownership.middleware.js — Resource Ownership Verification
 * ======================================================================
 * Ensures a user can only modify resources they own.
 * Admins bypass the check and can access any resource.
 *
 * Attaches req.resource to avoid a redundant DB fetch in the controller.
 *
 * Must be used AFTER protect middleware (req.user must exist).
 *
 * Usage:
 *   router.patch('/:id', protect, checkOwnership(Product), updateProduct)
 *   router.delete('/:id', protect, checkOwnership(Review), deleteReview)
 */

const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// ── checkOwnership ────────────────────────────────────────────────────────────

/**
 * @param {import('mongoose').Model} Model — Mongoose model to query
 * @param {string} [ownerField='user']     — field on the document that holds the owner ID
 *                                           Use 'seller' for Product if sellers own products
 */
const checkOwnership = (Model, ownerField = 'user') =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return next(new AppError('Invalid resource ID.', 400));
    }

    const resource = await Model.findById(id);

    if (!resource) {
      return next(new AppError('Resource not found.', 404));
    }

    // Admins can access any resource — bypass ownership check
    if (req.user.role === 'admin') {
      req.resource = resource;
      return next();
    }

    // Determine owner — resource may use 'user' or 'seller' depending on model
    const ownerId =
      resource[ownerField]?.toString() ||
      resource.user?.toString()        ||
      resource.seller?.toString();

    if (!ownerId || ownerId !== req.user._id.toString()) {
      return next(
        new AppError('You are not authorised to modify this resource.', 403)
      );
    }

    // Attach the already-fetched document so the controller doesn't re-query
    req.resource = resource;
    next();
  });

// ── checkSelfOrAdmin ──────────────────────────────────────────────────────────

/**
 * Lighter check for user-scoped routes like PATCH /users/:id.
 * Allows the request if req.user._id === req.params.id OR the user is an admin.
 * No DB fetch needed — just compares IDs.
 *
 * Usage:
 *   router.patch('/:id', protect, checkSelfOrAdmin, updateUser)
 */
const checkSelfOrAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required.', 401));
  }

  const isAdmin = req.user.role === 'admin';
  const isSelf  = req.params.id === req.user._id.toString();

  if (!isAdmin && !isSelf) {
    return next(
      new AppError('You are not authorised to perform this action.', 403)
    );
  }

  next();
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { checkOwnership, checkSelfOrAdmin };