'use strict';

/**
 * models/Notification.js — Notification Schema & Model
 * =======================================================
 */

const mongoose = require('mongoose');
const { NOTIFICATION_TYPE } = require('../utils/enums');

// ── NotificationSchema ────────────────────────────────────────────────────────

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Notification must belong to a user.'],
    },

    type: {
      type:     String,
      enum:     Object.values(NOTIFICATION_TYPE),
      required: [true, 'Notification type is required.'],
    },

    title: {
      type:      String,
      required:  [true, 'Title is required.'],
      trim:      true,
      maxlength: [100, 'Title must not exceed 100 characters.'],
    },

    message: {
      type:      String,
      required:  [true, 'Message is required.'],
      trim:      true,
      maxlength: [500, 'Message must not exceed 500 characters.'],
    },

    // Frontend route to navigate to when the notification is clicked
    link: {
      type: String,
    },

    isRead: {
      type:    Boolean,
      default: false,
    },

    // Flexible extra data (orderId, productId, etc.) — not indexed
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Fast unread count query: countDocuments({ user, isRead: false })
NotificationSchema.index({ user: 1, isRead: 1 });

// Fast listing query: find({ user }).sort({ createdAt: -1 })
NotificationSchema.index({ user: 1, createdAt: -1 });

// TTL index: auto-delete notifications after 30 days
// cleanup.job.js also deletes read ones on a weekly basis, but this
// ensures ALL notifications (read or unread) are purged after 30 days
// so the collection never grows unbounded.
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
);

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * Get the count of unread notifications for a user.
 * Used by the Socket.IO notification handler for badge updates.
 *
 * @param  {mongoose.Types.ObjectId|string} userId
 * @returns {Promise<number>}
 */
NotificationSchema.statics.getUnreadCount = function (userId) {
  return this.countDocuments({ user: userId, isRead: false });
};

/**
 * Mark a single notification as read.
 * Guards against cross-user access by requiring both id and user.
 *
 * @param  {string} notificationId
 * @param  {string} userId
 * @returns {Promise<object>}
 */
NotificationSchema.statics.markOneAsRead = function (notificationId, userId) {
  return this.updateOne(
    { _id: notificationId, user: userId },
    { $set: { isRead: true } }
  );
};

/**
 * Mark all notifications for a user as read.
 *
 * @param  {mongoose.Types.ObjectId|string} userId
 * @returns {Promise<object>}
 */
NotificationSchema.statics.markAllAsRead = function (userId) {
  return this.updateMany(
    { user: userId, isRead: false },
    { $set: { isRead: true } }
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const Notification = mongoose.model('Notification', NotificationSchema);
module.exports = Notification;