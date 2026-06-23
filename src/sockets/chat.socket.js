'use strict';

/**
 * sockets/chat.socket.js — Live Customer Support Chat
 * =====================================================
 * Handles real-time chat between customers and admin support agents.
 * Registered per-connection by sockets/index.js.
 *
 * Room naming convention:  chat:{roomId}
 *   roomId is an orderId — one support chat per order.
 *   Customers can only join rooms linked to their own orders.
 *   Admins can join any room.
 *
 * Client → Server events:
 *   chat:join      — join a chat room
 *   chat:message   — send a message
 *   chat:typing    — broadcast typing indicator
 *   chat:leave     — leave a room
 *   chat:history   — fetch last N messages from DB
 *
 * Server → Client events:
 *   chat:joined    — join confirmed
 *   chat:message   — message broadcast to room members
 *   chat:typing    — typing indicator forwarded to room
 *   chat:history   — paginated message history
 *   chat:userJoined / chat:userLeft — presence events
 *   chat:error     — operation failure (only to the originating socket)
 */

const mongoose = require('mongoose');
const Order    = require('../models/Order');
const logger   = require('../utils/logger');

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 1_000; // characters
const MAX_HISTORY_LIMIT  = 50;    // messages per history fetch
const TYPING_DEBOUNCE_MS = 3_000; // suppress repeated 'stopped typing' emits

// ── chatSocketHandler ─────────────────────────────────────────────────────────

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket — already authenticated
 */
module.exports = function chatSocketHandler(io, socket) {

  // Track rooms this socket has joined (for cleanup on disconnect)
  const joinedRooms = new Set();

  // Per-room typing debounce timers
  const typingTimers = new Map();

  // ── chat:join ─────────────────────────────────────────────────────────────

  socket.on('chat:join', async ({ roomId } = {}) => {
    if (!roomId) {
      return socket.emit('chat:error', {
        event:   'chat:join',
        message: 'roomId is required.',
      });
    }

    try {
      // ── Authorisation check ────────────────────────────────────────────────
      // Admins can join any room.
      // Customers must own the order referenced by roomId.
      if (socket.userRole !== 'admin') {
        if (!mongoose.isValidObjectId(roomId)) {
          return socket.emit('chat:error', {
            event:   'chat:join',
            message: 'Invalid roomId.',
          });
        }

        const order = await Order.findOne({
          _id:  roomId,
          user: socket.userId,
        }).select('_id').lean();

        if (!order) {
          return socket.emit('chat:error', {
            event:   'chat:join',
            message: 'You are not authorised to join this chat room.',
          });
        }
      }

      const room = `chat:${roomId}`;

      // Idempotent — joining an already-joined room is a no-op in Socket.IO
      socket.join(room);
      joinedRooms.add(room);

      // Confirm join to the joining socket
      socket.emit('chat:joined', {
        roomId,
        userId:   socket.userId,
        userRole: socket.userRole,
      });

      // Notify others in the room that someone joined (useful for admin panel)
      socket.to(room).emit('chat:userJoined', {
        userId:   socket.userId,
        userRole: socket.userRole,
        joinedAt: new Date().toISOString(),
      });

      logger.debug('Socket joined chat room', {
        socketId: socket.id,
        userId:   socket.userId,
        roomId,
      });
    } catch (err) {
      logger.error('chat:join failed', {
        userId: socket.userId,
        roomId,
        error:  err.message,
      });

      socket.emit('chat:error', {
        event:   'chat:join',
        message: 'Failed to join chat room.',
      });
    }
  });

  // ── chat:message ──────────────────────────────────────────────────────────

  socket.on('chat:message', async ({ roomId, message } = {}) => {
    if (!roomId || !message) {
      return socket.emit('chat:error', {
        event:   'chat:message',
        message: 'roomId and message are required.',
      });
    }

    const trimmed = typeof message === 'string' ? message.trim() : '';

    if (trimmed.length === 0) {
      return socket.emit('chat:error', {
        event:   'chat:message',
        message: 'Message cannot be empty.',
      });
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return socket.emit('chat:error', {
        event:   'chat:message',
        message: `Message exceeds the ${MAX_MESSAGE_LENGTH}-character limit.`,
      });
    }

    // Guard: socket must have joined the room before it can send messages
    const room = `chat:${roomId}`;
    if (!joinedRooms.has(room)) {
      return socket.emit('chat:error', {
        event:   'chat:message',
        message: 'You must join the chat room before sending messages.',
      });
    }

    try {
      const msgData = {
        id:         `${Date.now()}-${socket.id.slice(0, 6)}`, // client-side dedup key
        roomId,
        senderId:   socket.userId,
        senderRole: socket.userRole,
        message:    trimmed,
        timestamp:  new Date().toISOString(),
      };

      // ── Optional persistence ───────────────────────────────────────────────
      // Uncomment when a ChatMessage model is added:
      //
      // const ChatMessage = require('../models/ChatMessage')
      // const saved = await ChatMessage.create({
      //   room:       roomId,
      //   sender:     socket.userId,
      //   senderRole: socket.userRole,
      //   message:    trimmed,
      // })
      // msgData.id = saved._id.toString()

      // Broadcast to everyone in the room (including the sender for confirmation)
      io.to(room).emit('chat:message', msgData);

      // Clear typing indicator for this sender when a message is sent
      if (typingTimers.has(roomId)) {
        clearTimeout(typingTimers.get(roomId));
        typingTimers.delete(roomId);
        socket.to(room).emit('chat:typing', {
          userId:   socket.userId,
          isTyping: false,
        });
      }

      logger.debug('Chat message sent', {
        userId: socket.userId,
        roomId,
        length: trimmed.length,
      });
    } catch (err) {
      logger.error('chat:message failed', {
        userId: socket.userId,
        roomId,
        error:  err.message,
      });

      socket.emit('chat:error', {
        event:   'chat:message',
        message: 'Failed to send message.',
      });
    }
  });

  // ── chat:typing ───────────────────────────────────────────────────────────
  // Broadcasts a typing indicator to all other room members.
  // Auto-stops after TYPING_DEBOUNCE_MS to handle clients that don't send
  // an explicit isTyping: false (e.g. browser tab closed while typing).

  socket.on('chat:typing', ({ roomId, isTyping } = {}) => {
    if (!roomId) return;

    const room = `chat:${roomId}`;
    if (!joinedRooms.has(room)) return; // Silently ignore if not in room

    // Forward to other room members (not back to sender)
    socket.to(room).emit('chat:typing', {
      userId:   socket.userId,
      isTyping: Boolean(isTyping),
    });

    // Auto-stop debounce: if client doesn't send isTyping: false within
    // TYPING_DEBOUNCE_MS, broadcast a stop event automatically
    if (isTyping) {
      if (typingTimers.has(roomId)) {
        clearTimeout(typingTimers.get(roomId));
      }

      typingTimers.set(
        roomId,
        setTimeout(() => {
          socket.to(room).emit('chat:typing', {
            userId:   socket.userId,
            isTyping: false,
          });
          typingTimers.delete(roomId);
        }, TYPING_DEBOUNCE_MS)
      );
    } else {
      // Client explicitly stopped typing — clear the debounce timer
      if (typingTimers.has(roomId)) {
        clearTimeout(typingTimers.get(roomId));
        typingTimers.delete(roomId);
      }
    }
  });

  // ── chat:history ──────────────────────────────────────────────────────────
  // Fetch recent messages when user (re)joins a room.
  // Requires a ChatMessage model — returns empty array until one is added.

  socket.on('chat:history', async ({ roomId, limit = 20, before } = {}) => {
    if (!roomId) {
      return socket.emit('chat:error', {
        event:   'chat:history',
        message: 'roomId is required.',
      });
    }

    const room = `chat:${roomId}`;
    if (!joinedRooms.has(room)) {
      return socket.emit('chat:error', {
        event:   'chat:history',
        message: 'You must join the chat room before requesting history.',
      });
    }

    try {
      const safeLimit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, parseInt(limit) || 20));

      // ── Uncomment when ChatMessage model is added ──────────────────────────
      // const ChatMessage = require('../models/ChatMessage')
      // const query = { room: roomId }
      // if (before) query.createdAt = { $lt: new Date(before) }
      //
      // const messages = await ChatMessage.find(query)
      //   .sort('-createdAt')
      //   .limit(safeLimit)
      //   .populate('sender', 'name avatar')
      //   .lean()
      //
      // socket.emit('chat:history', {
      //   roomId,
      //   messages: messages.reverse(), // oldest first
      //   hasMore:  messages.length === safeLimit,
      // })

      // Placeholder until ChatMessage model is created
      socket.emit('chat:history', {
        roomId,
        messages: [],
        hasMore:  false,
        note:     'Message persistence not yet enabled.',
      });
    } catch (err) {
      logger.error('chat:history failed', {
        userId: socket.userId,
        roomId,
        error:  err.message,
      });

      socket.emit('chat:error', {
        event:   'chat:history',
        message: 'Failed to fetch chat history.',
      });
    }
  });

  // ── chat:leave ────────────────────────────────────────────────────────────

  socket.on('chat:leave', ({ roomId } = {}) => {
    if (!roomId) return;

    const room = `chat:${roomId}`;
    socket.leave(room);
    joinedRooms.delete(room);

    // Clean up any pending typing timer for this room
    if (typingTimers.has(roomId)) {
      clearTimeout(typingTimers.get(roomId));
      typingTimers.delete(roomId);
    }

    // Notify remaining room members
    socket.to(room).emit('chat:userLeft', {
      userId:   socket.userId,
      userRole: socket.userRole,
      leftAt:   new Date().toISOString(),
    });

    logger.debug('Socket left chat room', {
      socketId: socket.id,
      userId:   socket.userId,
      roomId,
    });
  });

  // ── Cleanup on disconnect ─────────────────────────────────────────────────
  // Socket.IO auto-removes the socket from all rooms on disconnect, but we
  // need to clear our local timers and notify room members.

  socket.on('disconnect', () => {
    // Clear all pending typing debounce timers
    for (const [roomId, timer] of typingTimers) {
      clearTimeout(timer);

      // Emit stopped-typing to any rooms this socket was still typing in
      socket.to(`chat:${roomId}`).emit('chat:typing', {
        userId:   socket.userId,
        isTyping: false,
      });
    }
    typingTimers.clear();

    // Notify all joined rooms that the user left
    for (const room of joinedRooms) {
      socket.to(room).emit('chat:userLeft', {
        userId:   socket.userId,
        userRole: socket.userRole,
        leftAt:   new Date().toISOString(),
      });
    }
    joinedRooms.clear();
  });

};