'use strict';

/**
 * middleware/upload.middleware.js — Multer File Upload Handling
 * ==============================================================
 * Uses memoryStorage so files land in req.file.buffer ready for
 * direct upload to Cloudinary / S3 — no temporary disk writes.
 *
 * Exports:
 *   uploadSingle(fieldName)       — single file  (avatars, category images)
 *   uploadMultiple(fieldName, n)  — up to n files (product images, review images)
 *   uploadFields(fields)          — mixed named fields
 */

const multer   = require('multer');
const AppError = require('../utils/AppError');
const { MAX_PRODUCT_IMAGES } = require('../utils/constants');

// ── Allowed MIME types ────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// ── Storage ────────────────────────────────────────────────────────────────────
// memoryStorage stores the file in req.file.buffer.
// Cloudinary's upload_stream and AWS PutObjectCommand both accept a Buffer
// directly — no need to write to /tmp first.

const storage = multer.memoryStorage();

// ── File filter ────────────────────────────────────────────────────────────────

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        `File type "${file.mimetype}" is not allowed. ` +
        `Please upload a JPEG, PNG, WebP, or GIF image.`,
        400
      ),
      false
    );
  }
}

// ── Multer instance ────────────────────────────────────────────────────────────

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize:  5 * 1024 * 1024,  // 5 MB per file
    files:     MAX_PRODUCT_IMAGES, // Absolute max across all fields
  },
});

// ── Named exports ──────────────────────────────────────────────────────────────

/**
 * Accept a single file on the given form field.
 * Available as req.file.
 *
 * Usage: router.patch('/avatar', protect, uploadSingle('avatar'), updateMe)
 */
const uploadSingle = (fieldName = 'image') => upload.single(fieldName);

/**
 * Accept up to `maxCount` files on the given form field.
 * Available as req.files (array).
 *
 * Usage: router.post('/', protect, uploadMultiple('images', 5), createProduct)
 */
const uploadMultiple = (fieldName = 'images', maxCount = MAX_PRODUCT_IMAGES) =>
  upload.array(fieldName, maxCount);

/**
 * Accept files across multiple named fields.
 * Available as req.files (object keyed by field name).
 *
 * Usage:
 *   uploadFields([
 *     { name: 'thumbnail', maxCount: 1 },
 *     { name: 'gallery',   maxCount: 4 },
 *   ])
 */
const uploadFields = (fields) => upload.fields(fields);

// ── Multer error wrapper ───────────────────────────────────────────────────────
// Wraps a multer middleware so MulterErrors are forwarded to the global
// error handler rather than crashing with an unhandled error event.
// errorHandler in error.middleware.js then converts them to clean AppErrors.
//
// Usage: wrapUpload(uploadMultiple('images', 5))(req, res, next)
// In practice the error handler already catches MulterError instances, so
// this is an optional extra safety net for dynamic usage.

function wrapUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) return next(err); // Forwards MulterError or fileFilter AppError
      next();
    });
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  upload,
  uploadSingle,
  uploadMultiple,
  uploadFields,
  wrapUpload,
};