"use strict";

/**
 * config/db.js — MongoDB Connection
 * ====================================
 * Establishes a Mongoose connection, wires up lifecycle event logging,
 * and exports the raw mongoose.connection so server.js can close it
 * cleanly during graceful shutdown.
 */

const mongoose = require("mongoose");
const logger = require("../utils/logger");

// ── Connection options ────────────────────────────────────────────────────────
const MONGO_OPTIONS = {
  // Fail fast in development rather than waiting 30 s for a bad URI
  serverSelectionTimeoutMS: 5_000,
  // How long the driver waits to establish a single TCP connection
  connectTimeoutMS: 10_000,
  // Keeps idle connections alive (useful on long-running serverless cold starts)
  socketTimeoutMS: 45_000,
  // Connection pool — tune based on expected concurrency
  maxPoolSize: 10,
  minPoolSize: 2,
};

// ── Lifecycle event listeners ─────────────────────────────────────────────────
// Attach once so they remain active across reconnect cycles.
mongoose.connection.on("connected", () => {
  logger.info("MongoDB connected", { host: mongoose.connection.host });
});

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected — driver will attempt to reconnect");
});

mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected");
});

mongoose.connection.on("error", (err) => {
  logger.error("MongoDB connection error", { error: err.message });
});

// ── Query debug logging (development only) ────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  mongoose.set("debug", (collectionName, method, query, doc) => {
    const safeDoc =
      doc && typeof doc === "object"
        ? Object.fromEntries(
            Object.entries(doc).filter(([k]) => k !== "session"),
          )
        : doc;
    logger.debug(`Mongoose: ${collectionName}.${method}`, { query, doc });
  });
}

// ── connectDB ─────────────────────────────────────────────────────────────────

/**
 * Connect to MongoDB.
 * Exits the process on failure — the app is unusable without a database.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    logger.error("MONGO_URI is not defined in environment variables");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, MONGO_OPTIONS);
    // 'connected' event above already logs the host
  } catch (err) {
    logger.error("Failed to connect to MongoDB", {
      error: err.message,
      uri: uri.replace(/:\/\/[^@]+@/, "://***:***@"), // Mask credentials in log
    });
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  connectDB,
  // Export the live connection reference so server.js can call .close()
  mongooseConnection: mongoose.connection,
};
