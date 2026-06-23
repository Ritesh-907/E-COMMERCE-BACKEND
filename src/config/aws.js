'use strict';

/**
 * config/aws.js — AWS S3 Configuration
 * =======================================
 * Configures the AWS SDK v3 S3 client and exports utility functions
 * for uploading, deleting, and generating signed URLs for private assets.
 *
 * This is the alternative storage backend to Cloudinary.
 * upload.service.js chooses between the two based on STORAGE_PROVIDER env var.
 *
 *   STORAGE_PROVIDER=cloudinary  → cloudinary.js helpers
 *   STORAGE_PROVIDER=s3          → this file's helpers
 *
 * Key naming convention:
 *   products/{timestamp}-{uuid}   — product images
 *   avatars/{userId}-{timestamp}  — user avatars
 *   invoices/{orderId}.pdf        — order invoices (private, use signed URLs)
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 }  = require('uuid');
const logger          = require('../utils/logger');

// ── S3 client ─────────────────────────────────────────────────────────────────

const s3Client = new S3Client({
  region:      process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;

// Warn at import time if the bucket is not configured — avoids silent failures
if (!BUCKET && process.env.STORAGE_PROVIDER === 's3') {
  logger.warn('AWS_S3_BUCKET is not set — S3 uploads will fail');
}

// ── uploadToS3 ────────────────────────────────────────────────────────────────

/**
 * Upload a Buffer to S3.
 *
 * @param {Buffer} buffer       — raw file bytes
 * @param {string} folder       — e.g. 'products', 'avatars'
 * @param {string} mimetype     — e.g. 'image/jpeg'
 * @param {string} [filename]   — optional original filename (for Content-Disposition)
 * @returns {Promise<{ url: string, key: string }>}
 */
async function uploadToS3(buffer, folder, mimetype, filename) {
  const ext = mimetype.split('/')[1] || 'bin';
  const key = `${folder}/${Date.now()}-${uuidv4()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimetype,
    // Public-read for product images; use 'private' for invoices/user documents
    ACL:         'public-read',
    // Store original filename as metadata for download flows
    Metadata:    filename ? { 'original-name': filename } : {},
    // Enable server-side encryption at rest
    ServerSideEncryption: 'AES256',
  });

  try {
    await s3Client.send(command);

    const url = `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    logger.debug('S3 upload successful', { key, mimetype });
    return { url, key };
  } catch (err) {
    logger.error('S3 upload failed', { key, error: err.message });
    throw err;
  }
}

// ── deleteFromS3 ──────────────────────────────────────────────────────────────

/**
 * Delete an object from S3 by key.
 * Safe to call with a null/undefined key (no-op).
 *
 * @param {string|null} key
 * @returns {Promise<void>}
 */
async function deleteFromS3(key) {
  if (!key) return;

  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
    );
    logger.debug('S3 delete successful', { key });
  } catch (err) {
    // Log but don't throw — a failed delete shouldn't break an API response
    logger.error('S3 delete failed', { key, error: err.message });
  }
}

// ── getSignedUrl ──────────────────────────────────────────────────────────────

/**
 * Generate a presigned GET URL for a private S3 object.
 * Use this for invoices, user data exports, and any ACL: 'private' asset.
 *
 * @param {string} key
 * @param {number} [expiresInSeconds=3600]
 * @returns {Promise<string>} presigned URL
 */
async function getSignedDownloadUrl(key, expiresInSeconds = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

// ── Key helpers ───────────────────────────────────────────────────────────────

/**
 * Build the public URL for an S3 object without generating a signed URL.
 * Only correct for ACL: 'public-read' objects.
 *
 * @param {string} key
 * @returns {string}
 */
function getPublicUrl(key) {
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ── Folder constants ──────────────────────────────────────────────────────────

const S3_FOLDERS = {
  PRODUCTS: 'products',
  AVATARS:  'avatars',
  INVOICES: 'invoices',
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  s3Client,
  uploadToS3,
  deleteFromS3,
  getSignedDownloadUrl,
  getPublicUrl,
  S3_FOLDERS,
};