"use strict";

/**
 * config/cloudinary.js — Cloudinary SDK Setup
 * ==============================================
 * Configures the Cloudinary v2 SDK and exports helper functions for
 * uploading and deleting media assets.
 *
 * Used by upload.service.js for product images and user avatars.
 * All uploads are organised into named folders:
 *   ecommerce/products   — product images
 *   ecommerce/avatars    — user profile pictures
 */

const { v2: cloudinary } = require('cloudinary');
const logger = require("../utils/logger");

// ── SDK configuration ─────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
  secure: true, // Always use HTTPS URLs
});

// ── Startup connectivity check ────────────────────────────────────────────────
// Runs once when the module is first imported (i.e. when app.js loads).
// Logs a warning on failure but does NOT exit — the app can still run
// without cloud storage (local /uploads fallback in upload.service.js).
(async () => {
  try {
    await cloudinary.api.ping();
    logger.info("Cloudinary connected", { cloud: process.env.CLOUD_NAME });
  } catch (err) {
    logger.warn("Cloudinary ping failed — cloud uploads may not work", {
      error: err.message,
    });
  }
})();

// ── Default upload options ────────────────────────────────────────────────────

const uploadOptions = {
  quality: "auto", // Let Cloudinary pick the best quality/size ratio
  fetch_format: "auto", // Serve WebP to browsers that support it
  flags: "progressive", // Progressive JPEG rendering
};

// ── Folder constants ──────────────────────────────────────────────────────────

const FOLDERS = {
  PRODUCTS: "ecommerce/products",
  AVATARS: "ecommerce/avatars",
};

// ── Helper: upload from buffer ────────────────────────────────────────────────

/**
 * Upload a file buffer to Cloudinary.
 *
 * @param {Buffer}  buffer    — raw file bytes (from multer memoryStorage)
 * @param {string}  folder    — target folder, use FOLDERS constant
 * @param {object}  [options] — override uploadOptions per call
 * @returns {Promise<{ url: string, public_id: string }>}
 */
function uploadBuffer(buffer, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        ...uploadOptions,
        ...options,
        // Auto-generate a public_id with a timestamp prefix for uniqueness
        use_filename: false,
        unique_filename: true,
        // Generate a thumbnail eagerly so it is ready immediately
        eager: [
          { width: 400, height: 400, crop: "thumb", gravity: "auto" },
          { width: 800, height: 800, crop: "limit" },
        ],
        eager_async: true,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
        });
      },
    );

    uploadStream.end(buffer);
  });
}

// ── Helper: delete by public_id ───────────────────────────────────────────────

/**
 * Delete an asset from Cloudinary.
 * Safe to call with a null/undefined public_id (no-op).
 *
 * @param {string|null} publicId
 * @returns {Promise<void>}
 */
async function deleteFromCloudinary(publicId) {
  if (!publicId) return;

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    if (result.result !== "ok") {
      logger.warn("Cloudinary delete returned unexpected result", {
        publicId,
        result: result.result,
      });
    }
  } catch (err) {
    // Log but don't throw — a failed delete shouldn't break the API response.
    logger.error("Failed to delete asset from Cloudinary", {
      publicId,
      error: err.message,
    });
  }
}

// ── Helper: get optimised URL ─────────────────────────────────────────────────

/**
 * Build a transformation URL for an existing asset.
 *
 * @param {string} publicId
 * @param {object} [transforms]
 * @returns {string}
 */
function getOptimisedUrl(publicId, transforms = {}) {
  return cloudinary.url(publicId, {
    secure: true,
    ...uploadOptions,
    ...transforms,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  cloudinary,
  uploadBuffer,
  deleteFromCloudinary,
  getOptimisedUrl,
  FOLDERS,
  uploadOptions,
};
