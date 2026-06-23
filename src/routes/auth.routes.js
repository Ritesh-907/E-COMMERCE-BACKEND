'use strict';

/**
 * routes/auth.routes.js — Authentication Routes
 * ================================================
 * Base path (mounted in index.js): /api/v1/auth
 */

const express  = require('express');
const passport = require('passport');

const authController     = require('../controllers/auth.controller');
const { protect }        = require('../middleware/auth.middleware');
const { authLimiter }    = require('../config/rateLimit');
const { validate }       = require('../middleware/validate.middleware');
const { auditLog }       = require('../middleware/audit.middleware');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../validators/auth.validator');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────

// POST /api/v1/auth/register
router.post(
  '/register',
  validate(registerSchema),
  auditLog('USER_REGISTER'),
  authController.register
);

// POST /api/v1/auth/login
// authLimiter: 10 req / 15 min per IP — brute-force protection
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  auditLog('USER_LOGIN'),
  authController.login
);

// POST /api/v1/auth/refresh-token
// No auth middleware — the refresh token in the cookie IS the credential
router.post('/refresh-token', authController.refreshToken);

// POST /api/v1/auth/forgot-password
// Same rate limiter as login — prevents email enumeration at high volume
router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

// PATCH /api/v1/auth/reset-password/:token
router.patch(
  '/reset-password/:token',
  validate(resetPasswordSchema),
  auditLog('PASSWORD_RESET'),
  authController.resetPassword
);

// GET /api/v1/auth/verify-email/:token
router.get('/verify-email/:token', authController.verifyEmail);

// ── Google OAuth ──────────────────────────────────────────────────────────────

// GET /api/v1/auth/google
// Redirects browser to Google's consent screen
router.get(
  '/google',
  passport.authenticate('google', {
    scope:   ['profile', 'email'],
    session: false,
    prompt: "select_account"
  })
);

// GET /api/v1/auth/google/callback
// Google redirects here after user grants / denies access
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session:         false,
    failureRedirect: `${process.env.CLIENT_URL}/auth/failed`,
  }),
  authController.googleCallback
);

// ── Protected routes ──────────────────────────────────────────────────────────

// POST /api/v1/auth/logout
router.post(
  '/logout',
  protect,
  auditLog('USER_LOGOUT'),
  authController.logout
);

module.exports = router;