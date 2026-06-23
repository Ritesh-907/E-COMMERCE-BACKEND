'use strict';

/**
 * services/notification.service.js — In-App Notification Service
 * ================================================================
 * Creates notifications in MongoDB and delivers them in real-time
 * via Socket.IO. Socket delivery is non-fatal — the user may be offline.
 */

const Notification = require('../models/Notification');
const AppError     = require('../utils/AppError');
const logger       = require('../utils/logger');

// Lazy import — sockets/index.js is initialised after this module loads
const getIO = () => {
  try {
    return require('../sockets/index').getIO();
  } catch {
    return null;
  }
};

// ── createNotification ────────────────────────────────────────────────────────

/**
 * Persist a notification and push it to the user's socket room.
 *
 * @param  {{
 *   userId:   string|ObjectId,
 *   type:     string,
 *   title:    string,
 *   message:  string,
 *   link?:    string,
 *   metadata?: object
 * }} payload
 * @returns {Promise<NotificationDocument>}
 */
async function createNotification({ userId, type, title, message, link, metadata }) {
  // 1. Persist to DB
  const notification = await Notification.create({
    user: userId,
    type,
    title,
    message,
    link:     link     || null,
    metadata: metadata || null,
  });

  // 2. Real-time delivery via Socket.IO (fire-and-forget)
  try {
    const io = getIO();
    if (io) {
      // Personal room: socket joins userId.toString() in sockets/index.js
      io.to(userId.toString()).emit('notification:new', {
        _id:       notification._id,
        type:      notification.type,
        title:     notification.title,
        message:   notification.message,
        link:      notification.link,
        isRead:    false,
        createdAt: notification.createdAt,
      });

      // Push updated unread count so the badge updates immediately
      const unreadCount = await Notification.getUnreadCount(userId);
      io.to(userId.toString()).emit('notification:count', { count: unreadCount });
    }
  } catch (err) {
    // Socket delivery failure is NOT fatal — user will see the notification
    // on next page load via HTTP or next socket reconnect
    logger.warn('createNotification: socket delivery failed', {
      userId,
      notificationId: notification._id,
      error:          err.message,
    });
  }

  return notification;
}

// ── markAsRead ────────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 * Guards against cross-user access by requiring both id and userId.
 *
 * @param  {string} notificationId
 * @param  {string} userId
 * @returns {Promise<NotificationDocument>}
 * @throws {AppError} 404 if not found or wrong user
 */
async function markAsRead(notificationId, userId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { $set: { isRead: true } },
    { new: true }
  );

  if (!notification) {
    throw new AppError('Notification not found.', 404);
  }

  return notification;
}

// ── markAllAsRead ─────────────────────────────────────────────────────────────

/**
 * Mark all unread notifications for a user as read.
 *
 * @param  {string|ObjectId} userId
 * @returns {Promise<{ modifiedCount: number }>}
 */
async function markAllAsRead(userId) {
  const result = await Notification.markAllAsRead(userId);
  return { modifiedCount: result.modifiedCount };
}

// ── getUnreadCount ────────────────────────────────────────────────────────────

/**
 * @param  {string|ObjectId} userId
 * @returns {Promise<number>}
 */
async function getUnreadCount(userId) {
  return Notification.getUnreadCount(userId);
}

// ── getUserNotifications ──────────────────────────────────────────────────────

/**
 * Paginated notification list for a user.
 *
 * @param  {string|ObjectId} userId
 * @param  {number} [page=1]
 * @param  {number} [limit=20]
 * @returns {Promise<{
 *   notifications: NotificationDocument[],
 *   unreadCount:   number,
 *   total:         number,
 *   page:          number,
 *   totalPages:    number
 * }>}
 */
async function getUserNotifications(userId, page = 1, limit = 20) {
  const safePage  = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  const skip      = (safePage - 1) * safeLimit;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),

    Notification.countDocuments({ user: userId }),

    Notification.getUnreadCount(userId),
  ]);

  return {
    notifications,
    unreadCount,
    total,
    page:       safePage,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

// ── deleteNotification ────────────────────────────────────────────────────────

/**
 * Delete a single notification (user-initiated dismiss).
 * Guards against cross-user access.
 *
 * @param  {string} notificationId
 * @param  {string} userId
 * @returns {Promise<void>}
 * @throws {AppError} 404 if not found
 */
async function deleteNotification(notificationId, userId) {
  const notification = await Notification.findOneAndDelete({
    _id:  notificationId,
    user: userId,
  });

  if (!notification) {
    throw new AppError('Notification not found.', 404);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createNotification,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  getUserNotifications,
  deleteNotification,
};