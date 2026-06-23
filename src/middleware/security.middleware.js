'use strict';

/**
 * middleware/security.middleware.js — Security Hardening
 * ========================================================
 * Applies all security-focused middleware in one place.
 * Called once in app.js before any route is mounted.
 *
 * Stack:
 *   helmet        — HTTP security headers (HSTS, CSP, etc.)
 *   mongoSanitize — NoSQL injection prevention
 *   xss           — HTML/JS injection sanitisation on req.body / query
 *   hpp           — HTTP parameter pollution prevention
 */

const helmet       = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss          = require('xss-clean');
const hpp          = require('hpp');

// ── configureSecurityMiddleware ───────────────────────────────────────────────

/**
 * @param {import('express').Application} app
 */
function configureSecurityMiddleware(app) {

  // ── 1. Disable Express fingerprinting ──────────────────────────────────────
  // Removes the X-Powered-By: Express header that tells attackers which
  // framework is running (helmet also sets this, but belt-and-suspenders).
  app.disable('x-powered-by');

  // ── 2. Trust proxy ─────────────────────────────────────────────────────────
  // Required when behind nginx / ALB / Cloudflare so that:
  //   - req.ip returns the real client IP (not the proxy IP)
  //   - Rate limiter keys are per-user rather than per-proxy
  // Set to 1 in production (one hop: nginx → Node); false in dev.
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // ── 3. Helmet — HTTP security headers ──────────────────────────────────────
  app.use(
    helmet({
      // Content-Security-Policy: only allow resources from own origin + CDNs
      contentSecurityPolicy: {
        directives: {
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'"],
          styleSrc:    ["'self'", "'unsafe-inline'"], // unsafe-inline needed for some email clients
          imgSrc:      ["'self'", 'data:', 'https://res.cloudinary.com', 'https://*.amazonaws.com'],
          connectSrc:  ["'self'"],
          fontSrc:     ["'self'"],
          objectSrc:   ["'none'"],
          frameSrc:    ["'none'"],
          upgradeInsecureRequests: [],
        },
      },

      // HTTP Strict Transport Security — force HTTPS for 1 year in production
      hsts: process.env.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,

      // Prevent browsers from MIME-sniffing a response away from declared content-type
      noSniff: true,

      // Block pages from being embedded in iframes (clickjacking protection)
      frameguard: { action: 'deny' },

      // Disable COEP — needed for Cloudinary / S3 images loaded cross-origin
      crossOriginEmbedderPolicy: false,

      // Allow cross-origin resource loading (CDN images, fonts)
      crossOriginResourcePolicy: { policy: 'cross-origin' },

      // Enable browser XSS filter (legacy, but harmless)
      xssFilter: true,

      // Prevent IE from opening downloads in the page context
      ieNoOpen: true,

      // Reduce referrer information leaked to third-party sites
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // ── 4. NoSQL injection sanitisation ────────────────────────────────────────
  // Strips keys that start with '$' or contain '.' from req.body, req.query,
  // and req.params — prevents attacks like { "email": { "$gt": "" } }
  app.use(
    mongoSanitize({
      replaceWith: '_', // Replace offending characters instead of removing key entirely
      onSanitize: ({ req, key }) => {
        // Log attempts in production for intrusion detection
        if (process.env.NODE_ENV === 'production') {
          const logger = require('../utils/logger');
          logger.warn('NoSQL injection attempt blocked', {
            key,
            ip:  req.ip,
            url: req.originalUrl,
          });
        }
      },
    })
  );

  // ── 5. XSS sanitisation ────────────────────────────────────────────────────
  // Sanitises HTML/JavaScript from req.body, req.query, and req.params.
  // Converts dangerous characters like < > " ' & to their HTML entities.
  app.use(xss());

  // ── 6. HTTP Parameter Pollution prevention ─────────────────────────────────
  // Prevents attacks that duplicate query params: ?sort=price&sort=name
  // Without hpp, Express puts them in an array which can break sorting logic.
  // Whitelist params that are legitimately used as arrays in this API.
  app.use(
    hpp({
      whitelist: [
        'sort',      // ?sort=price&sort=-createdAt
        'fields',    // ?fields=name&fields=price
        'tags',      // ?tags=electronics&tags=sale
        'status',    // ?status=pending&status=processing (order filters)
        'category',  // ?category=phones&category=tablets
        'rating',    // ?rating=4&rating=5 (review filters)
      ],
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { configureSecurityMiddleware };