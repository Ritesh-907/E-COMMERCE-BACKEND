"use strict";

/**
 * config/passport.js — Passport.js Strategy Configuration
 * ==========================================================
 * Registers two strategies:
 *
 *  1. JWT Strategy   — authenticates API requests via Bearer token
 *  2. Google OAuth   — handles the Google sign-in / sign-up flow
 *
 * Stateless design: no sessions, no serializeUser / deserializeUser.
 * On Google login the server issues its own JWT pair — Google tokens
 * are discarded after the profile is fetched.
 *
 * Export: initPassport(app) — call once in app.js.
 */

const passport = require("passport");
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");

const User = require("../models/User");
const logger = require("../utils/logger");
const AppError = require("../utils/AppError");

// ── 1. JWT Strategy ───────────────────────────────────────────────────────────
// Extracts the Bearer token from the Authorization header and validates it.
// req.user is populated on every protected route that uses this strategy.

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
  issuer: "ecommerce-api",
  audience: "ecommerce-users",
};

const jwtStrategy = new JwtStrategy(jwtOptions, async (payload, done) => {
  try {
    // Select only what downstream middleware and controllers actually need.
    // Excluding password avoids accidentally leaking it in a serialised user.
    const user = await User.findById(payload.id).select("-password -__v");

    if (!user) {
      return done(null, false, { message: "User not found" });
    }

    if (!user.isActive) {
      return done(null, false, { message: "Account is deactivated" });
    }

    return done(null, user);
  } catch (err) {
    logger.error("JWT strategy error", { error: err.message });
    return done(err, false);
  }
});

// ── 2. Google OAuth 2.0 Strategy ─────────────────────────────────────────────
// Handles both new sign-ups and returning Google users.
// Account merging: if the email already exists we link the Google ID to it
// rather than creating a duplicate account.

const googleStrategy = new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/api/v1/auth/google/callback",
    // Request the email scope so we can find / create accounts by email
    scope: ["profile", "email"],
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const avatarUrl = profile.photos?.[0]?.value;
      const googleId = profile.id;
      const displayName = profile.displayName || "";
      const [firstName, ...rest] = displayName.split(" ");
      const lastName = rest.join(" ") || "";

      if (!email) {
        return done(
          new AppError("Google account did not return an email address.", 400),
          false,
        );
      }

      // ── Case 1: Existing user with this googleId ────────────────────────────
      let user = await User.findOne({ googleId });

      if (user) {
        // Keep avatar fresh in case the user changed their Google photo
        if (avatarUrl && !user.avatar?.public_id) {
          user.avatar = { url: avatarUrl, public_id: null };
          await user.save({ validateBeforeSave: false });
        }
        return done(null, user);
      }

      // ── Case 2: Existing user with same email (account merge) ───────────────
      user = await User.findOne({ email: email.toLowerCase() });

      if (user) {
        user.googleId = googleId;
        user.isVerified = true; // Google verified the email
        if (avatarUrl && !user.avatar?.public_id) {
          user.avatar = { url: avatarUrl, public_id: null };
        }
        await user.save({ validateBeforeSave: false });
        return done(null, user);
      }

      // ── Case 3: Brand new user ──────────────────────────────────────────────
      user = await User.create({
        name: displayName, // ← add this
        email: email.toLowerCase(),
        googleId,
        isVerified: true,
        avatar: {
          url: avatarUrl || "",
          public_id: null,
        },
      });
      logger.info("New user created via Google OAuth", { userId: user._id });
      return done(null, user);
    } catch (err) {
      logger.error("Google OAuth strategy error", { error: err.message });
      return done(err, false);
    }
  },
);

// ── Register strategies ───────────────────────────────────────────────────────

passport.use("jwt", jwtStrategy);
passport.use("google", googleStrategy);

// ── initPassport ──────────────────────────────────────────────────────────────

/**
 * Initialize Passport middleware on the Express app.
 * Call once in app.js AFTER body parsers.
 *
 * @param {import('express').Application} app
 */
function initPassport(app) {
  // passport.initialize() injects req.user and the authenticate() method.
  // No session middleware needed — API is fully stateless.
  app.use(passport.initialize());
  logger.info("Passport initialized (JWT + Google OAuth)");
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { initPassport, passport };
