#!/usr/bin/env node
'use strict';

/**
 * scripts/createAdmin.js — First Admin User Creator
 * ====================================================
 * Creates the first admin user on a fresh deployment.
 * Safe to run multiple times — exits cleanly if an admin already exists.
 *
 * USAGE:
 *   ADMIN_EMAIL=admin@yourstore.com ADMIN_PASS=SecurePass123! node scripts/createAdmin.js
 *
 *   Or with .env file:
 *   node -r dotenv/config scripts/createAdmin.js
 *
 * ENVIRONMENT VARIABLES:
 *   ADMIN_NAME   — admin display name  (default: 'Admin')
 *   ADMIN_EMAIL  — admin email         (required)
 *   ADMIN_PASS   — admin password      (required, min 8 chars)
 *   MONGO_URI    — MongoDB URI         (required, from .env)
 */

require('dotenv').config();

const mongoose = require('mongoose');

// ── Config ────────────────────────────────────────────────────────────────────

const ADMIN_NAME  = process.env.ADMIN_NAME  || 'Admin';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS  = process.env.ADMIN_PASS;
const MONGO_URI   = process.env.MONGO_URI;

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

function log(msg)   { console.log(`  ${msg}`); }
function ok(msg)    { console.log(`\n  ✅  ${msg}\n`); }
function fail(msg)  { console.error(`\n  ❌  ${msg}\n`); }
function warn(msg)  { console.warn(`\n  ⚠️   ${msg}\n`); }

// ── Validation ────────────────────────────────────────────────────────────────

function validateEnv() {
  const missing = [];
  if (!MONGO_URI)   missing.push('MONGO_URI');
  if (!ADMIN_EMAIL) missing.push('ADMIN_EMAIL');
  if (!ADMIN_PASS)  missing.push('ADMIN_PASS');

  if (missing.length > 0) {
    fail(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('  Usage:');
    console.error('    ADMIN_EMAIL=admin@store.com ADMIN_PASS=SecurePass123! node scripts/createAdmin.js\n');
    process.exit(1);
  }

  if (ADMIN_PASS.length < 8) {
    fail('ADMIN_PASS must be at least 8 characters.');
    process.exit(1);
  }

  // Basic email format check
  if (!/^\S+@\S+\.\S+$/.test(ADMIN_EMAIL)) {
    fail(`"${ADMIN_EMAIL}" is not a valid email address.`);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  ══════════════════════════════════════');
  console.log('   Create Admin — E-Commerce Backend');
  console.log('  ══════════════════════════════════════\n');

  // 1. Validate environment
  validateEnv();

  // 2. Connect to MongoDB
  log(`Connecting to MongoDB...`);
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    log('Connected.\n');
  } catch (err) {
    fail(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }

  // Import model AFTER connecting to avoid mongoose not-connected errors
  const User = require('../src/models/User');

  // 3. Check if an admin already exists
  const existingAdmin = await User.findOne({ role: 'admin' }).select('email');
  if (existingAdmin) {
    warn(`An admin account already exists (${maskEmail(existingAdmin.email)}).`);
    warn('If you need another admin, update the role via the admin dashboard.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 4. Check if this email is already registered under a different role
  const existingUser = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() }).select('role');
  if (existingUser) {
    if (existingUser.role !== 'admin') {
      // Promote existing user to admin
      warn(`Email ${maskEmail(ADMIN_EMAIL)} already registered as "${existingUser.role}".`);
      log('Promoting to admin role...');
      existingUser.role       = 'admin';
      existingUser.isVerified = true;
      existingUser.isActive   = true;
      await existingUser.save({ validateBeforeSave: false });
      ok(`User promoted to admin: ${maskEmail(ADMIN_EMAIL)}`);
    } else {
      ok(`Admin already exists with this email: ${maskEmail(ADMIN_EMAIL)}`);
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  // 5. Create the admin user
  log(`Creating admin account: ${maskEmail(ADMIN_EMAIL)}`);

  try {
    await User.create({
      name:       ADMIN_NAME,
      email:      ADMIN_EMAIL.toLowerCase(),
      password:   ADMIN_PASS,     // Pre-save hook in User model hashes this automatically
      role:       'admin',
      isVerified: true,
      isActive:   true,
    });
  } catch (err) {
    fail(`Failed to create admin: ${err.message}`);
    if (err.errors) {
      Object.values(err.errors).forEach((e) => console.error(`    • ${e.message}`));
    }
    await mongoose.disconnect();
    process.exit(1);
  }

  // 6. Verify it was saved correctly
  const saved = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() }).select('name email role isVerified');
  if (!saved) {
    fail('Admin was not found after creation. Something went wrong.');
    await mongoose.disconnect();
    process.exit(1);
  }

  ok(`Admin created successfully!`);
  console.log('  Details:');
  console.log(`    Name  : ${saved.name}`);
  console.log(`    Email : ${maskEmail(saved.email)}`);
  console.log(`    Role  : ${saved.role}`);
  console.log('');
  console.log('  ⚠️  Store your credentials securely.');
  console.log('  ⚠️  Never commit ADMIN_PASS to version control.\n');

  await mongoose.disconnect();
  process.exit(0);
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  console.error(err.stack);
  mongoose.disconnect().finally(() => process.exit(1));
});