'use strict';

/**
 * controllers/user.controller.js — User Profile & Admin User Management
 * =======================================================================
 */

const mongoose   = require('mongoose');
const User       = require('../models/User');
const Order      = require('../models/Order');
const Cart       = require('../models/Cart');
const Wishlist   = require('../models/Wishlist');
const RefreshToken = require('../models/RefreshToken');
const authService  = require('../services/auth.service');
const uploadService = require('../services/upload.service');
const asyncHandler  = require('../utils/asyncHandler');
const AppError      = require('../utils/AppError');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { getPaginationParams, buildPaginationMeta } = require('../utils/pagination');
const APIFeatures  = require('../utils/apiFeatures');
const { pickFields, omitFields } = require('../utils/helpers');
const logger       = require('../utils/logger');

const SAFE_USER_FIELDS = '-password -emailVerifyToken -emailVerifyExpire -passwordResetToken -passwordResetExpire -__v';

// ── getMe ─────────────────────────────────────────────────────────────────────

exports.getMe = asyncHandler(async (req, res) => {
  // req.user is already attached by auth middleware; re-fetch to get addresses
  const user = await User.findById(req.user._id).select(SAFE_USER_FIELDS);
  successResponse(res, { user });
});

// ── updateMe ──────────────────────────────────────────────────────────────────

exports.updateMe = asyncHandler(async (req, res) => {
  // Strictly whitelist allowed fields — users must NOT update role, isActive, etc.
  const updates = pickFields(req.body, ['name', 'phone']);

  if (req.file) {
    // Upload new avatar
    const newAvatar = await uploadService.uploadImage(
      req.file.buffer,
      'ecommerce/avatars'
    );

    // Delete old avatar from Cloudinary if it was a managed asset
    if (req.user.avatar?.public_id) {
      await uploadService.deleteImage(req.user.avatar.public_id).catch(() => {});
    }

    updates.avatar = newAvatar;
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updates },
    { new: true, runValidators: true }
  ).select(SAFE_USER_FIELDS);

  successResponse(res, { user }, 'Profile updated successfully.');
});

// ── updatePassword ────────────────────────────────────────────────────────────

exports.updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 401);

  user.password = newPassword;
  await user.save(); // pre-save hook hashes the new password

  // Revoke all existing refresh tokens to force re-login on other devices
  await authService.revokeAllUserTokens(user._id);

  logger.info('Password changed', { userId: user._id });

  // Re-issue tokens for current session so user stays logged in here
  const { accessToken, refreshToken } = await authService.generateTokenPair(
    user._id,
    req.headers['user-agent'],
    req.ip
  );

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

  successResponse(res, { accessToken }, 'Password updated. Please use your new password to log in on other devices.');
});

// ── deleteMe (soft delete) ────────────────────────────────────────────────────

exports.deleteMe = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { isActive: false });
  await authService.revokeAllUserTokens(req.user._id);

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  logger.info('Account self-deactivated', { userId: req.user._id });
  successResponse(res, null, 'Your account has been deactivated.');
});

// ── Address management ────────────────────────────────────────────────────────

exports.addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const { isDefault } = req.body;

  // If this is the first address or explicitly set as default,
  // clear the existing default flag
  if (user.addresses.length === 0 || isDefault) {
    user.addresses.forEach((addr) => { addr.isDefault = false; });
  }

  user.addresses.push({
    ...pickFields(req.body, ['street', 'city', 'state', 'zip', 'country', 'phone', 'label']),
    isDefault: user.addresses.length === 0 ? true : Boolean(isDefault),
  });

  await user.save({ validateBeforeSave: false });
  successResponse(res, { addresses: user.addresses }, 'Address added.');
});

exports.updateAddress = asyncHandler(async (req, res) => {
  const user    = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.addressId);

  if (!address) throw new AppError('Address not found.', 404);

  const allowed = ['street', 'city', 'state', 'zip', 'country', 'phone', 'label', 'isDefault'];
  Object.assign(address, pickFields(req.body, allowed));

  // If this address is being set as default, clear others
  if (req.body.isDefault) {
    user.addresses.forEach((addr) => {
      addr.isDefault = addr._id.toString() === req.params.addressId;
    });
  }

  await user.save({ validateBeforeSave: false });
  successResponse(res, { addresses: user.addresses }, 'Address updated.');
});

exports.deleteAddress = asyncHandler(async (req, res) => {
  const user    = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.addressId);

  if (!address) throw new AppError('Address not found.', 404);

  const wasDefault = address.isDefault;
  user.addresses.pull(req.params.addressId);

  // If the deleted address was default and others remain, promote the first
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save({ validateBeforeSave: false });
  successResponse(res, { addresses: user.addresses }, 'Address removed.');
});

exports.setDefaultAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  let found = false;
  user.addresses.forEach((addr) => {
    addr.isDefault = addr._id.toString() === req.params.addressId;
    if (addr.isDefault) found = true;
  });

  if (!found) throw new AppError('Address not found.', 404);

  await user.save({ validateBeforeSave: false });
  successResponse(res, { addresses: user.addresses }, 'Default address updated.');
});

// ── Admin: getAllUsers ────────────────────────────────────────────────────────

exports.getAllUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query);

  const features = new APIFeatures(
    User.find().select(SAFE_USER_FIELDS),
    req.query
  )
    .filter()
    .search(['name', 'email'])
    .sort()
    .limitFields();

  // Run find + count in parallel for performance
  const baseQuery = User.find(features.query.getFilter()).select(SAFE_USER_FIELDS);
  const [users, total] = await Promise.all([
    baseQuery.skip(skip).limit(limit).lean(),
    User.countDocuments(features.query.getFilter()),
  ]);

  paginatedResponse(res, users, buildPaginationMeta(total, page, limit));
});

// ── Admin: getUserById ────────────────────────────────────────────────────────

exports.getUserById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid user ID.', 400);
  }

  const [user, orderCount] = await Promise.all([
    User.findById(req.params.id).select(SAFE_USER_FIELDS),
    Order.countDocuments({ user: req.params.id }),
  ]);

  if (!user) throw new AppError('User not found.', 404);

  successResponse(res, { user: { ...user.toObject(), orderCount } });
});

// ── Admin: updateUser (role + isActive only) ──────────────────────────────────

exports.updateUser = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid user ID.', 400);
  }

  // Admins cannot demote themselves
  if (req.params.id === req.user._id.toString() && req.body.role) {
    throw new AppError('You cannot change your own role.', 403);
  }

  const updates = pickFields(req.body, ['role', 'isActive']);

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).select(SAFE_USER_FIELDS);

  if (!user) throw new AppError('User not found.', 404);

  // If deactivated, revoke all their tokens immediately
  if (updates.isActive === false) {
    await authService.revokeAllUserTokens(req.params.id);
  }

  successResponse(res, { user }, 'User updated.');
});

// ── Admin: deleteUser (hard delete) ──────────────────────────────────────────

exports.deleteUser = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError('Invalid user ID.', 400);
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found.', 404);

  // Delete user's avatar from Cloudinary if managed
  if (user.avatar?.public_id) {
    await uploadService.deleteImage(user.avatar.public_id).catch(() => {});
  }

  // Clean up all related data in parallel
  await Promise.all([
    Cart.deleteOne({ user: req.params.id }),
    Wishlist.deleteOne({ user: req.params.id }),
    RefreshToken.deleteMany({ user: req.params.id }),
    user.deleteOne(),
  ]);

  logger.info('User hard-deleted by admin', {
    targetUserId: req.params.id,
    adminId:      req.user._id,
  });

  successResponse(res, null, 'User deleted permanently.');
});