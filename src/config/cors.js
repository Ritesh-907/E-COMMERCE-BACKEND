"use strict";

/**
 * config/cors.js — CORS Configuration
 * ======================================
 * Defines which origins may access the API and what they are allowed
 * to do. Passed directly to the `cors` middleware in app.js.
 *
 * credentials: true is required so browsers send httpOnly cookies
 * (refresh tokens) on cross-origin requests.
 */

const logger = require("../utils/logger");

// ── Allowed origins ───────────────────────────────────────────────────────────

const PROD_ORIGINS = [
  process.env.CLIENT_URL, // Primary production frontend
  process.env.ADMIN_URL, // Admin dashboard (if separate)
].filter(Boolean); // Remove undefined entries

const DEV_ORIGINS = [
  "http://localhost:3000", // CRA / Next.js dev server
  "http://localhost:5173", // Vite dev server
  "http://localhost:4173", // Vite preview server
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
];

const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? PROD_ORIGINS
    : [...PROD_ORIGINS, ...DEV_ORIGINS];

// ── Origin validator ──────────────────────────────────────────────────────────

function originValidator(origin, callback) {
  // Allow requests with no origin header:
  //   - Server-to-server (REST clients, cron jobs)
  //   - Mobile apps (React Native, Flutter)
  //   - curl / Postman / Insomnia
  if (!origin) return callback(null, true);

  if (allowedOrigins.includes(origin)) {
    return callback(null, true);
  }

  // Log rejected origins in development to ease debugging
  if (process.env.NODE_ENV !== "production") {
    logger.warn("CORS blocked request from unlisted origin", { origin });
  }

  callback(new Error(`Origin '${origin}' is not allowed by CORS policy`));
}

// ── Exported options ──────────────────────────────────────────────────────────

const corsOptions = {
  origin: originValidator,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "X-No-Compression", // Used in app.js compression filter
  ],

  // Expose these response headers to the browser JS code
  exposedHeaders: [
    "X-Total-Count", // Pagination total
    "X-Cache", // Cache HIT / MISS (cache.middleware.js)
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset",
  ],

  // Required for httpOnly cookie (refresh token) to be sent cross-origin
  credentials: true,

  // Return 200 instead of 204 for preflight — fixes issues with some
  // older browsers and HTTP clients
  optionsSuccessStatus: 200,

  // Cache preflight response for 1 hour (reduces OPTIONS round-trips)
  maxAge: 3600,
};

module.exports = corsOptions;
