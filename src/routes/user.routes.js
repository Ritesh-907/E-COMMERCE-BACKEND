'use strict';

/**
 * routes/user.routes.js — User Profile & Admin User Management Routes
 * =====================================================================
 * Base path (mounted in index.js): /api/v1/users
 *
 * IMPORTANT: /me routes MUST be declared before /:id routes.
 * Express matches routes in registration order — if /:id comes first,
 * GET /me would be matched with id = 'me' instead of the /me handler.
 */

const express = require('express');

const userController         = require('../controllers/user.controller');
const { protect }            = require('../middleware/auth.middleware');
const { authorize }          = require('../middleware/authorize.middleware');
const { uploadSingle }       = require('../middleware/upload.middleware');
const { validate }           = require('../middleware/validate.middleware');
const { auditLog }           = require('../middleware/audit.middleware');
const {
  updateUserSchema,
  adminUpdateUserSchema,
  addressSchema,
  updateAddressSchema,
} = require('../validators/user.validator');
const { updatePasswordSchema } = require('../validators/auth.validator');

const router = express.Router();

// All routes in this file require authentication
router.use(protect);

// ── Current user (self) ───────────────────────────────────────────────────────

router
  .route('/me')
  .get(userController.getMe)
  .patch(
    uploadSingle('avatar'),
    validate(updateUserSchema),
    userController.updateMe
  );

// PATCH /me/password — separate from /me to require current password confirmation
router.patch(
  '/me/password',
  validate(updatePasswordSchema),
  auditLog('PASSWORD_CHANGE'),
  userController.updatePassword
);

// DELETE /me — soft-delete (sets isActive: false)
router.delete(
  '/me',
  auditLog('ACCOUNT_DEACTIVATE'),
  userController.deleteMe
);

// ── Address management ────────────────────────────────────────────────────────

router.post(
  '/me/addresses',
  validate(addressSchema),
  userController.addAddress
);

router
  .route('/me/addresses/:addressId')
  .patch(validate(updateAddressSchema), userController.updateAddress)
  .delete(userController.deleteAddress);

router.patch(
  '/me/addresses/:addressId/default',
  userController.setDefaultAddress
);
// GET /api/v1/users/me/notifications
router.get('/me/notifications', userController.getMyNotifications);

// PATCH /api/v1/users/me/notifications/read-all
router.patch('/me/notifications/read-all', userController.markAllNotificationsRead);
// ── Admin: user management ────────────────────────────────────────────────────
// All routes below require admin role (applied per-route for clarity)

router
  .route('/')
  .get(authorize('admin'), userController.getAllUsers);

router
  .route('/:id')
  .get(authorize('admin'), userController.getUserById)
  .patch(
    authorize('admin'),
    validate(adminUpdateUserSchema),
    auditLog('ADMIN_UPDATE_USER'),
    userController.updateUser
  )
  .delete(
    authorize('admin'),
    auditLog('ADMIN_DELETE_USER'),
    userController.deleteUser
  );

module.exports = router;