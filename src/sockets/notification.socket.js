'use strict';

/**
 * sockets/notification.socket.js — Real-Time Notification Handler
 * =================================================================
 * Handles all client-initiated notification events for a single socket.
 * Registered per-connection by sockets/index.js.
 *
 * Server → Client events  (emitted from services/jobs):
 *   notification:new      — new notification pushed to user's room
 *   notification:count    — current unread badge count
 *
 * Client → Server events  (handled here):
 *   notification:read        — mark one notification as read
 *   notification:readAll     — mark all as read
 *   notification:getCount    — request current unread count
 *   notification:getList     — paginated notification list
 *   notification:delete      — delete one notification
 */

const notificationService = require('../services/notification.service');
const logger              = require('../utils/logger');

// ── notificationSocketHandler ─────────────────────────────────────────────────

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket  — already authenticated (socket.userId set)
 */
module.exports = function notificationSocketHandler(io, socket) {

  // ── On connect: push unread count immediately ─────────────────────────────
  // The badge in the nav updates as soon as the user connects — no need for
  // the client to make a separate HTTP request.
  notificationService
    .getUnreadCount(socket.userId)
    .then((count) => socket.emit('notification:count', { count }))
    .catch((err) => {
      logger.warn('Failed to send initial unread count', {
        userId: socket.userId,
        error:  err.message,
      });
    });

  // ── notification:read ─────────────────────────────────────────────────────
  // Mark a single notification as read and push the new unread count back.

  socket.on('notification:read', async ({ notificationId } = {}) => {
    if (!notificationId) {
      return socket.emit('notification:error', {
        event:   'notification:read',
        message: 'notificationId is required.',
      });
    }

    try {
      await notificationService.markAsRead(notificationId, socket.userId);

      const count = await notificationService.getUnreadCount(socket.userId);

      socket.emit('notification:count',        { count });
      socket.emit('notification:readConfirmed', { notificationId });
    } catch (err) {
      logger.warn('notification:read failed', {
        userId:         socket.userId,
        notificationId,
        error:          err.message,
      });

      socket.emit('notification:error', {
        event:   'notification:read',
        message: err.message || 'Failed to mark notification as read.',
      });
    }
  });

  // ── notification:readAll ──────────────────────────────────────────────────
  // Mark every unread notification for this user as read in one DB write.

  socket.on('notification:readAll', async () => {
    try {
      const { modifiedCount } = await notificationService.markAllAsRead(socket.userId);

      // Badge goes to 0
      socket.emit('notification:count',       { count: 0 });
      socket.emit('notification:readAllDone', { markedCount: modifiedCount });
    } catch (err) {
      logger.warn('notification:readAll failed', {
        userId: socket.userId,
        error:  err.message,
      });

      socket.emit('notification:error', {
        event:   'notification:readAll',
        message: 'Failed to mark all notifications as read.',
      });
    }
  });

  // ── notification:getCount ─────────────────────────────────────────────────
  // On-demand unread count refresh — client can call this after reconnecting
  // or after any local state sync.

  socket.on('notification:getCount', async () => {
    try {
      const count = await notificationService.getUnreadCount(socket.userId);
      socket.emit('notification:count', { count });
    } catch (err) {
      // Silent — don't emit an error for a count check failure
      logger.warn('notification:getCount failed', {
        userId: socket.userId,
        error:  err.message,
      });
    }
  });

  // ── notification:getList ──────────────────────────────────────────────────
  // Paginated notification list for the dropdown / dedicated page.

  socket.on('notification:getList', async ({ page = 1, limit = 20 } = {}) => {
    try {
      // Clamp values to prevent abuse
      const safePage  = Math.max(1, parseInt(page)  || 1);
      const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));

      const result = await notificationService.getUserNotifications(
        socket.userId,
        safePage,
        safeLimit
      );

      socket.emit('notification:list', result);
    } catch (err) {
      logger.warn('notification:getList failed', {
        userId: socket.userId,
        error:  err.message,
      });

      socket.emit('notification:error', {
        event:   'notification:getList',
        message: 'Failed to fetch notifications.',
      });
    }
  });

  // ── notification:delete ───────────────────────────────────────────────────
  // Delete a single notification (user-initiated, e.g. "dismiss" button).

  socket.on('notification:delete', async ({ notificationId } = {}) => {
    if (!notificationId) {
      return socket.emit('notification:error', {
        event:   'notification:delete',
        message: 'notificationId is required.',
      });
    }

    try {
      await notificationService.deleteNotification(notificationId, socket.userId);

      // Push updated count after deletion
      const count = await notificationService.getUnreadCount(socket.userId);

      socket.emit('notification:count',         { count });
      socket.emit('notification:deleteConfirmed', { notificationId });
    } catch (err) {
      logger.warn('notification:delete failed', {
        userId:         socket.userId,
        notificationId,
        error:          err.message,
      });

      socket.emit('notification:error', {
        event:   'notification:delete',
        message: err.message || 'Failed to delete notification.',
      });
    }
  });

};