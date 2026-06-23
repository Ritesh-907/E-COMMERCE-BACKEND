'use strict';

/**
 * sockets/index.js — Socket.IO Server Initialisation
 * =====================================================
 * Initialises the Socket.IO server, authenticates every incoming
 * connection via JWT, places each socket in a personal room and an
 * optional admin room, then delegates feature events to:
 *
 *   notificationSocketHandler(io, socket)
 *   chatSocketHandler(io, socket)
 *
 * Singleton pattern: initSocket() stores the io instance in module
 * scope; getIO() returns it from anywhere in the codebase without
 * needing to pass the instance around.
 *
 * Usage from services / event-listeners:
 *   const { getIO } = require('../sockets')
 *   getIO().to(userId.toString()).emit('notification:new', payload)
 *   getIO().to('admin-room').emit('admin:lowStock', payload)
 */

const { Server }    = require('socket.io');
const User          = require('../models/User');
const { verifyAccessToken } = require('../config/jwt');
const logger        = require('../utils/logger');

const notificationSocketHandler = require('./notification.socket');
const chatSocketHandler         = require('./chat.socket');

// ── Module-level singleton ────────────────────────────────────────────────────

let io = null;

// ── initSocket ────────────────────────────────────────────────────────────────

/**
 * Attach Socket.IO to the existing http.Server.
 * Called once from server.js AFTER server.listen() resolves.
 *
 * @param {import('http').Server} httpServer
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    // CORS: mirror the REST API's allowed origins
    cors: {
      origin:      process.env.CLIENT_URL || 'http://localhost:3000',
      credentials: true,
      methods:     ['GET', 'POST'],
    },

    // How long (ms) the server waits for a pong before considering a client gone
    pingTimeout:  60_000,

    // How often (ms) the server sends a ping to keep the connection alive
    pingInterval: 25_000,

    // How long a disconnected socket's room memberships are preserved
    // before the socket is fully cleaned up (useful for quick reconnects)
    connectTimeout: 45_000,

    // Prefer WebSocket; fall back to long-polling for clients behind proxies
    transports: ['websocket', 'polling'],
  });

  // ── JWT authentication middleware ─────────────────────────────────────────
  // Runs synchronously for every new connection attempt BEFORE the
  // 'connection' event fires. Calling next(error) rejects the handshake.

  io.use(async (socket, next) => {
    try {
      // Token can arrive in two ways:
      //   1. { auth: { token: '...' } }  — socket.io-client standard
      //   2. Authorization: Bearer <token>  — for clients that send headers
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];

      if (!raw) {
        return next(new Error('Authentication required — no token provided.'));
      }

      // verifyAccessToken throws AppError for invalid / expired tokens
      const decoded = verifyAccessToken(raw);

      // Minimal DB lookup — only fields needed for socket routing
      const user = await User.findById(decoded.id).select('_id role isActive').lean();

      if (!user) {
        return next(new Error('Authentication failed — user not found.'));
      }

      if (!user.isActive) {
        return next(new Error('Authentication failed — account is deactivated.'));
      }

      // Attach to socket so handlers can read without another DB query
      socket.userId   = user._id.toString();
      socket.userRole = user.role;

      next();
    } catch (err) {
      // Log without the full stack — connection rejections are expected for
      // expired tokens and are not server errors
      logger.warn('Socket auth rejected', {
        socketId: socket.id,
        reason:   err.message,
      });
      next(new Error('Authentication failed — invalid token.'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    // ── Personal room ───────────────────────────────────────────────────────
    // Every user joins a room named after their userId.
    // Allows targeted delivery:  io.to(userId).emit('notification:new', data)
    socket.join(socket.userId);

    // ── Admin room ──────────────────────────────────────────────────────────
    // All admin users share a broadcast room for system-wide alerts
    // (low stock, new orders, flagged reviews, etc.).
    if (socket.userRole === 'admin') {
      socket.join('admin-room');
      logger.debug('Admin joined admin-room', { userId: socket.userId });
    }

    logger.debug('Socket connected', {
      socketId:  socket.id,
      userId:    socket.userId,
      role:      socket.userRole,
    });

    // ── Feature handlers ────────────────────────────────────────────────────
    notificationSocketHandler(io, socket);
    chatSocketHandler(io, socket);

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.debug('Socket disconnected', {
        socketId: socket.id,
        userId:   socket.userId,
        reason,
      });
    });

    // ── Error guard ─────────────────────────────────────────────────────────
    // Catches errors thrown inside event handlers that weren't caught locally.
    socket.on('error', (err) => {
      logger.error('Socket error', {
        socketId: socket.id,
        userId:   socket.userId,
        error:    err.message,
      });
    });
  });

  logger.info('Socket.IO initialised', {
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout:  60_000,
  });

  return io;
}

// ── getIO ─────────────────────────────────────────────────────────────────────

/**
 * Returns the singleton Socket.IO instance.
 * Throws if called before initSocket() — provides a clear error instead
 * of a silent null-dereference crash.
 *
 * @returns {import('socket.io').Server}
 */
function getIO() {
  if (!io) {
    throw new Error(
      'Socket.IO has not been initialised. Call initSocket(httpServer) in server.js first.'
    );
  }
  return io;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { initSocket, getIO };