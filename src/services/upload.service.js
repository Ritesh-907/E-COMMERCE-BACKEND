'use strict';

/**
 * services/upload.service.js — Image Upload Service (Cloudinary)
 * ================================================================
 * Converts multer memoryStorage buffers to streams and uploads to Cloudinary.
 * All functions wrap errors in AppError so callers get a consistent shape.
 */

const { PassThrough }     = require('stream');
const { cloudinary } = require('../config/cloudinary');
const AppError            = require('../utils/AppError');
const logger              = require('../utils/logger');

// ── bufferToStream ────────────────────────────────────────────────────────────

/**
 * Convert a Buffer to a Node.js readable stream.
 * Required by Cloudinary's upload_stream API.
 *
 * @param  {Buffer} buffer
 * @returns {PassThrough}
 */
function bufferToStream(buffer) {
  const passThrough = new PassThrough();
  passThrough.end(buffer);
  return passThrough;
}

// ── uploadImage ───────────────────────────────────────────────────────────────

/**
 * Upload a single image buffer to Cloudinary.
 *
 * @param  {Buffer} fileBuffer
 * @param  {string} folder       — Cloudinary folder, e.g. 'ecommerce/products'
 * @param  {string} [publicId]   — optional; Cloudinary auto-generates one if omitted
 * @returns {Promise<{ url: string, public_id: string }>}
 * @throws {AppError} on Cloudinary error
 */
function uploadImage(fileBuffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        ...(publicId && { public_id: publicId }),

        // Auto-select best format (WebP for supporting browsers)
        fetch_format: 'auto',
        quality:      'auto',

        // Eager transformations cached at upload time:
        //   thumb_400  — product cards / avatars
        //   large_800  — product detail pages
        eager: [
          { width: 400, height: 400, crop: 'thumb', gravity: 'auto' },
          { width: 800, height: 800, crop: 'limit' },
        ],
        eager_async: true,
      },
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload failed', {
            folder,
            error: error.message,
          });
          return reject(
            new AppError(`Image upload failed: ${error.message}`, 502)
          );
        }

        resolve({
          url:       result.secure_url,
          public_id: result.public_id,
        });
      }
    );

    // Pipe the buffer into the Cloudinary stream
    bufferToStream(fileBuffer).pipe(uploadStream);
  });
}

// ── uploadMultipleImages ──────────────────────────────────────────────────────

/**
 * Upload multiple images in parallel.
 *
 * @param  {Array<{ buffer: Buffer, originalname: string }>} files — multer file array
 * @param  {string} folder
 * @returns {Promise<Array<{ url: string, public_id: string }>>}
 */
async function uploadMultipleImages(files, folder) {
  return Promise.all(
    files.map((file) => uploadImage(file.buffer, folder))
  );
}

// ── deleteImage ───────────────────────────────────────────────────────────────

/**
 * Delete a single Cloudinary asset by public_id.
 * Safe to call with null/undefined (no-op).
 *
 * @param  {string|null} publicId
 * @returns {Promise<void>}
 */
async function deleteImage(publicId) {
  if (!publicId) return;

  try {
    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result !== 'ok' && result.result !== 'not found') {
      logger.warn('Cloudinary delete returned unexpected result', {
        publicId,
        result: result.result,
      });
    }
  } catch (err) {
    // Log but don't throw — a failed delete shouldn't break an API response
    logger.error('Cloudinary deleteImage failed', {
      publicId,
      error: err.message,
    });
  }
}

// ── deleteMultipleImages ──────────────────────────────────────────────────────

/**
 * Delete multiple Cloudinary assets in one API call.
 * Used when deleting a product with several images.
 *
 * @param  {string[]} publicIds
 * @returns {Promise<void>}
 */
async function deleteMultipleImages(publicIds) {
  if (!publicIds || publicIds.length === 0) return;

  // Filter out any null/undefined values
  const validIds = publicIds.filter(Boolean);
  if (validIds.length === 0) return;

  try {
    await cloudinary.api.delete_resources(validIds);
  } catch (err) {
    logger.error('Cloudinary deleteMultipleImages failed', {
      publicIds: validIds,
      error:     err.message,
    });
    // Non-fatal — log and continue
  }
}

// ── generateThumbnailUrl ──────────────────────────────────────────────────────

/**
 * Generate an on-the-fly transformation URL for an existing Cloudinary asset.
 * Does NOT re-upload the image — Cloudinary applies the transformation on first
 * request and caches it on their CDN.
 *
 * @param  {string} publicId
 * @param  {number} [width=300]
 * @param  {number} [height=300]
 * @returns {string}
 */
function generateThumbnailUrl(publicId, width = 300, height = 300) {
  return cloudinary.url(publicId, {
    width,
    height,
    crop:         'thumb',
    gravity:      'auto',
    fetch_format: 'auto',
    quality:      'auto',
    secure:       true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  uploadImage,
  uploadMultipleImages,
  deleteImage,
  deleteMultipleImages,
  generateThumbnailUrl,
};