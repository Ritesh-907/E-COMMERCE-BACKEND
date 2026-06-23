"use strict";

/**
 * controllers/auth.controller.js — Authentication Controller
 * ============================================================
 * Handles register, login, token refresh, logout,
 * Google OAuth callback, and all password/email flows.
 */

const crypto = require("crypto");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const authService = require("../services/auth.service");
const emailService = require("../services/email.service");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { successResponse, createdResponse } = require("../utils/response");
const { verifyRefreshToken } = require("../config/jwt");
const { omitFields } = require("../utils/helpers");
const logger = require("../utils/logger");

// ── Cookie options ────────────────────────────────────────────────────────────

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ── Helper: issue tokens + send response ─────────────────────────────────────

async function sendTokenResponse(user, statusCode, req, res) {
  const { accessToken, refreshToken } = await authService.generateTokenPair(
    user._id,
    req.headers["user-agent"],
    req.ip,
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

  const safeUser = omitFields(user.toObject ? user.toObject() : user, [
    "password",
    "emailVerifyToken",
    "emailVerifyExpire",
    "passwordResetToken",
    "passwordResetExpire",
    "__v",
  ]);

  res.status(statusCode).json({
    success: true,
    accessToken,
    data: { user: safeUser },
  });
}

// ── register ──────────────────────────────────────────────────────────────────

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new AppError("Email is already registered.", 400);

  const user = await User.create({ name, email, password });

  const rawToken = user.getEmailVerifyToken();
  await user.save({ validateBeforeSave: false });

  // Fire-and-forget — don't let email failure block registration
  emailService.sendVerificationEmail(user, rawToken).catch((err) => {
    logger.error("Failed to send verification email", {
      userId: user._id,
      error: err.message,
    });
  });

  createdResponse(
    res,
    null,
    "Registration successful. Please check your email to verify your account.",
  );
});

// ── login ─────────────────────────────────────────────────────────────────────

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Select password explicitly (it has select: false on the schema)
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password",
  );
  if (user.googleId && !user.password) {
    throw new AppError(
      "This account was created using Google. Please sign in with Google.",
      400,
    );
  }

  // Use same message for not-found and wrong-password to prevent email enumeration
  if (!user || !(await user.comparePassword(password))) {
    logger.warn("Failed login attempt", { email, ip: req.ip });
    throw new AppError("Invalid email or password.", 401);
  }

  if (!user.isActive) {
    throw new AppError(
      "Your account has been deactivated. Please contact support.",
      403,
    );
  }

  if (!user.isVerified) {
    throw new AppError(
      "Please verify your email address before logging in.",
      403,
    );
  }

  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  logger.info("User logged in", { userId: user._id, ip: req.ip });
  await sendTokenResponse(user, 200, req, res);
});

// ── refreshToken ──────────────────────────────────────────────────────────────

exports.refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new AppError("No refresh token provided.", 401);

  // Verify signature and decode
  const decoded = verifyRefreshToken(token); // throws AppError on failure

  // Check DB record: not revoked, not expired
  await authService.verifyAndGetRefreshToken(token);

  // Rotate: revoke old, issue new pair
  const { accessToken, refreshToken: newRefreshToken } =
    await authService.rotateRefreshToken(
      token,
      decoded.id,
      req.headers["user-agent"],
      req.ip,
    );

  res.cookie("refreshToken", newRefreshToken, COOKIE_OPTIONS);

  successResponse(res, { accessToken }, "Token refreshed.");
});

// ── logout ────────────────────────────────────────────────────────────────────

exports.  logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (token) {
    await authService.revokeToken(token).catch(() => {
      // Non-fatal: token may already be expired / not in DB
    });
  }

  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });

  successResponse(res, null, "Logged out successfully.");
});

// ── forgotPassword ────────────────────────────────────────────────────────────

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  // Always respond the same way — don't reveal whether the email exists
  if (user) {
    const rawToken = user.getPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    emailService.sendPasswordResetEmail(user, rawToken).catch((err) => {
      logger.error("Failed to send password reset email", {
        userId: user._id,
        error: err.message,
      });
    });
  }

  successResponse(
    res,
    null,
    "If that email is registered, a reset link has been sent.",
  );
});

// ── resetPassword ─────────────────────────────────────────────────────────────

exports.resetPassword = asyncHandler(async (req, res) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpire: { $gt: Date.now() },
  });

  if (!user)
    throw new AppError("Password reset link is invalid or has expired.", 400);

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpire = undefined;
  await user.save(); // pre-save hook hashes the password

  // Revoke all refresh tokens to force re-login on all devices
  await authService.revokeAllUserTokens(user._id);

  logger.info("Password reset completed", { userId: user._id, ip: req.ip });

  // Auto-login: issue new token pair
  await sendTokenResponse(user, 200, req, res);
});

// ── verifyEmail ───────────────────────────────────────────────────────────────

exports.verifyEmail = asyncHandler(async (req, res) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    emailVerifyToken: hashedToken,
    emailVerifyExpire: { $gt: Date.now() },
  });

  if (!user)
    throw new AppError("Verification link is invalid or has expired.", 400);

  user.isVerified = true;
  user.emailVerifyToken = undefined;
  user.emailVerifyExpire = undefined;
  await user.save({ validateBeforeSave: false });

  emailService.sendWelcomeEmail(user).catch(() => {}); // non-critical

  logger.info("Email verified", { userId: user._id });
  successResponse(
    res,
    null,
    "Email verified successfully. You can now log in.",
  );
});

// ── googleCallback ────────────────────────────────────────────────────────────
// req.user is populated by Passport GoogleStrategy before this runs

exports.googleCallback = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Google authentication failed.", 401);

  const { accessToken, refreshToken } = await authService.generateTokenPair(
    req.user._id,
    req.headers["user-agent"],
    req.ip,
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

  // Redirect to frontend with access token in query string
  // The frontend stores it in memory (NOT localStorage for security)
  // const redirectUrl = `${process.env.CLIENT_URL}/auth/success?token=${accessToken}`; //->> When creaet Frontend remove the comment
  // res.redirect(redirectUrl);// ->> Remove the comment
  res.status(200).json({
    status: "success",
    accessToken,
    user: req.user,
  });
});
