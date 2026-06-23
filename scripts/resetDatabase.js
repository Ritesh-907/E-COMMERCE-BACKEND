#!/usr/bin/env node
'use strict';

/**
 * scripts/resetDatabase.js — Full Database Reset
 * =================================================
 * !! DESTRUCTIVE — drops all collections. Development / test only. !!
 *
 * USAGE:
 *   node scripts/resetDatabase.js           → prompts for confirmation
 *   node scripts/resetDatabase.js --yes     → skip prompt (CI pipelines)
 *   node scripts/resetDatabase.js --seed    → reset then seed automatically
 *
 * ENVIRONMENT:
 *   NODE_ENV   — must NOT be 'production' (hard-blocked)
 *   MONGO_URI  — MongoDB connection string
 */

require('dotenv').config();

const mongoose  = require('mongoose');
const readline  = require('readline');

// ── Config ────────────────────────────────────────────────────────────────────

const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGO_URI = process.env.MONGO_URI;

// CLI flags
const SKIP_CONFIRM = process.argv.includes('--yes') || NODE_ENV === 'test';
const AUTO_SEED    = process.argv.includes('--seed');

// Collections to drop — explicit list is safer than dropDatabase()
// because it preserves indexes / views we don't manage
const COLLECTIONS = [
  'users',
  'products',
  'categories',
  'orders',
  'carts',
  'reviews',
  'coupons',
  'wishlists',
  'notifications',
  'refreshtokens',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)   { console.log(`  ${msg}`); }
function ok(msg)    { console.log(`\n  ✅  ${msg}\n`); }
function fail(msg)  { console.error(`\n  ❌  ${msg}\n`); }
function warn(msg)  { console.warn(`  ⚠️   ${msg}`); }

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  ══════════════════════════════════════════');
  console.log('   Reset Database — E-Commerce Backend');
  console.log('  ══════════════════════════════════════════\n');

  // ── 1. Production guard — MUST be first ──────────────────────────────────
  if (NODE_ENV === 'production') {
    fail('REFUSED: Cannot reset the database in production!');
    fail('Set NODE_ENV to "development" or "test" if this is intentional.');
    process.exit(1);
  }

  // ── 2. Validate env ───────────────────────────────────────────────────────
  if (!MONGO_URI) {
    fail('MONGO_URI is not set. Please configure it in your .env file.');
    process.exit(1);
  }

  // ── 3. Confirmation prompt ────────────────────────────────────────────────
  warn(`Environment : ${NODE_ENV}`);
  warn(`Database    : ${MONGO_URI.replace(/:\/\/[^@]+@/, '://***:***@')}`);
  warn(`Collections : ${COLLECTIONS.join(', ')}\n`);

  if (!SKIP_CONFIRM) {
    console.log('  !! This will permanently delete ALL data in the above collections !!\n');
    const answer = await prompt('  Type "yes" to confirm reset: ');

    if (answer.toLowerCase() !== 'yes') {
      log('Reset aborted — no changes made.\n');
      process.exit(0);
    }
  } else {
    log('--yes flag detected — skipping confirmation prompt.');
  }

  // ── 4. Connect ────────────────────────────────────────────────────────────
  log('\nConnecting to MongoDB...');
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    log('Connected.\n');
  } catch (err) {
    fail(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }

  // ── 5. Drop collections ───────────────────────────────────────────────────
  log('Dropping collections...\n');

  const db       = mongoose.connection.db;
  let   dropped  = 0;
  let   skipped  = 0;

  for (const name of COLLECTIONS) {
    try {
      await db.dropCollection(name);
      log(`  ✓  ${name}`);
      dropped++;
    } catch (err) {
      if (err.codeName === 'NamespaceNotFound' || err.code === 26) {
        // Collection doesn't exist yet — that's fine
        log(`  -  ${name} (not found, skipped)`);
        skipped++;
      } else {
        // Unexpected error — log but continue
        warn(`Failed to drop "${name}": ${err.message}`);
        skipped++;
      }
    }
  }

  console.log('');
  log(`Dropped  : ${dropped} collection(s)`);
  log(`Skipped  : ${skipped} collection(s) (didn't exist)\n`);

  // ── 6. Optional auto-seed ─────────────────────────────────────────────────
  if (AUTO_SEED) {
    log('--seed flag detected — running seeder...\n');
    try {
      // Seed script expects mongoose to already be connected
      // so we pass the connection across by not disconnecting first
      await require('./seed').run();
    } catch (err) {
      fail(`Seeder failed: ${err.message}`);
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  ok(`Database reset complete${AUTO_SEED ? ' (+ seeded)' : ''}.`);

  await mongoose.disconnect();
  process.exit(0);
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  console.error(err.stack);
  mongoose.disconnect().finally(() => process.exit(1));
});