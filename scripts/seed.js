#!/usr/bin/env node
'use strict';

/**
 * scripts/seed.js — Database Seeder
 * ====================================
 * Populates the database with realistic sample data for development & testing.
 *
 * USAGE:
 *   node scripts/seed.js             → clears existing data then seeds
 *   node scripts/seed.js --destroy   → clears data only (no re-seed)
 *   node scripts/seed.js --no-clear  → appends data without clearing first
 *
 * DEPENDENCIES (dev only):
 *   npm install -D @faker-js/faker
 *
 * ACCOUNTS CREATED:
 *   admin@test.com   / Admin123!   (role: admin)
 *   seller@test.com  / Seller123!  (role: seller)
 *   user@test.com    / User1234!   (role: user)
 *   + 7 random users
 */

require('dotenv').config();

const mongoose = require('mongoose');

// ── Flags ─────────────────────────────────────────────────────────────────────

const DESTROY_ONLY = process.argv.includes('--destroy');
const NO_CLEAR     = process.argv.includes('--no-clear');
const STANDALONE   = require.main === module; // true when run directly, false when require()'d

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`\n  ✅  ${msg}\n`); }
function fail(msg) { console.error(`\n  ❌  ${msg}\n`); }
function section(title) {
  console.log(`\n  ── ${title} ${'─'.repeat(Math.max(0, 40 - title.length))}`);
}

// ── Seed data factories ───────────────────────────────────────────────────────

function buildCategories() {
  return [
    { name: 'Electronics',   order: 1 },
    { name: 'Clothing',      order: 2 },
    { name: 'Books',         order: 3 },
    { name: 'Home & Garden', order: 4 },
    { name: 'Sports',        order: 5 },
    { name: 'Beauty',        order: 6 },
  ];
}

function buildSubCategories(parentMap) {
  return [
    { name: 'Smartphones', parent: parentMap['Electronics'], order: 1 },
    { name: 'Laptops',     parent: parentMap['Electronics'], order: 2 },
    { name: 'Headphones',  parent: parentMap['Electronics'], order: 3 },
    { name: "Men's Wear",  parent: parentMap['Clothing'],    order: 1 },
    { name: "Women's Wear",parent: parentMap['Clothing'],    order: 2 },
    { name: 'Fiction',     parent: parentMap['Books'],       order: 1 },
    { name: 'Non-Fiction', parent: parentMap['Books'],       order: 2 },
  ];
}

function buildUsers() {
  return [
    {
      name:       'Admin User',
      email:      'admin@test.com',
      password:   'Admin123!',
      role:       'admin',
      isVerified: true,
      isActive:   true,
    },
    {
      name:       'Seller User',
      email:      'seller@test.com',
      password:   'Seller123!',
      role:       'seller',
      isVerified: true,
      isActive:   true,
    },
    {
      name:       'Test User',
      email:      'user@test.com',
      password:   'User1234!',
      role:       'user',
      isVerified: true,
      isActive:   true,
    },
  ];
}

function buildFakeUsers(faker, count = 7) {
  return Array.from({ length: count }, () => ({
    name:       faker.person.fullName(),
    email:      faker.internet.email().toLowerCase(),
    password:   'User1234!',
    role:       'user',
    isVerified: true,
    isActive:   true,
  }));
}

function buildProducts(faker, categories, sellerId) {
  const productTemplates = [
    // Electronics
    { name: 'Wireless Noise-Cancelling Headphones', categoryName: 'Headphones',  brand: 'SoundPro',   price: 129.99, comparePrice: 179.99 },
    { name: 'Mechanical Gaming Keyboard',           categoryName: 'Electronics', brand: 'TechGear',   price: 89.99,  comparePrice: 119.99 },
    { name: 'USB-C Hub 7-in-1',                    categoryName: 'Electronics', brand: 'ConnectX',   price: 39.99,  comparePrice: null    },
    { name: 'Portable Bluetooth Speaker',           categoryName: 'Electronics', brand: 'SoundPro',   price: 59.99,  comparePrice: 79.99   },
    { name: '27" 4K IPS Monitor',                  categoryName: 'Laptops',     brand: 'ViewMax',    price: 449.99, comparePrice: 549.99  },
    { name: 'Wireless Charging Pad',               categoryName: 'Smartphones', brand: 'ChargeFast', price: 24.99,  comparePrice: null    },

    // Clothing
    { name: 'Classic Fit Cotton T-Shirt',           categoryName: "Men's Wear",  brand: 'BasicWear',  price: 19.99,  comparePrice: null   },
    { name: 'Slim-Fit Chino Trousers',             categoryName: "Men's Wear",  brand: 'UrbanStyle', price: 49.99,  comparePrice: 64.99  },
    { name: 'Floral Summer Dress',                 categoryName: "Women's Wear",brand: 'BloomWear',  price: 44.99,  comparePrice: 59.99  },
    { name: 'Wool Blend Blazer',                   categoryName: "Women's Wear",brand: 'UrbanStyle', price: 99.99,  comparePrice: 139.99 },

    // Books
    { name: 'The Pragmatic Programmer',            categoryName: 'Non-Fiction', brand: 'Addison',    price: 34.99,  comparePrice: null   },
    { name: 'Clean Code',                          categoryName: 'Non-Fiction', brand: 'Prentice',   price: 29.99,  comparePrice: 39.99  },
    { name: 'Dune',                                categoryName: 'Fiction',     brand: 'Ace Books',  price: 14.99,  comparePrice: null   },
    { name: 'The Midnight Library',                categoryName: 'Fiction',     brand: 'Canongate',  price: 12.99,  comparePrice: 16.99  },

    // Home & Garden
    { name: 'Ceramic Pour-Over Coffee Set',        categoryName: 'Home & Garden',brand: 'BrewMaster',price: 34.99,  comparePrice: null   },
    { name: 'Bamboo Cutting Board Set (3-piece)',  categoryName: 'Home & Garden',brand: 'KitchenPro',price: 27.99,  comparePrice: 34.99  },
    { name: 'Smart LED Desk Lamp',                 categoryName: 'Home & Garden',brand: 'LightUp',   price: 49.99,  comparePrice: 59.99  },

    // Sports
    { name: 'Yoga Mat (Extra Thick 6mm)',          categoryName: 'Sports',      brand: 'FlexFit',    price: 29.99,  comparePrice: null   },
    { name: 'Adjustable Dumbbell Set (5–25kg)',    categoryName: 'Sports',      brand: 'IronWorks',  price: 199.99, comparePrice: 249.99 },
    { name: 'Water-Resistant Running Jacket',      categoryName: 'Sports',      brand: 'SpeedRun',   price: 79.99,  comparePrice: 99.99  },

    // Beauty
    { name: 'Vitamin C Brightening Serum',         categoryName: 'Beauty',      brand: 'GlowLab',    price: 32.99,  comparePrice: null   },
    { name: 'Hyaluronic Acid Moisturiser 50ml',    categoryName: 'Beauty',      brand: 'HydraPlus',  price: 24.99,  comparePrice: 29.99  },
  ];

  // Build a category name → _id lookup (flat list after subcategories are inserted)
  const catMap = {};
  categories.forEach((c) => { catMap[c.name] = c._id; });

  return productTemplates.map((p) => ({
    name:        p.name,
    description: faker.commerce.productDescription() + ' ' + faker.lorem.sentences(2),
    shortDesc:   faker.commerce.productDescription(),
    price:       p.price,
    comparePrice:p.comparePrice || null,
    category:    catMap[p.categoryName] || categories[0]._id,
    seller:      sellerId,
    brand:       p.brand,
    stock:       faker.number.int({ min: 0, max: 100 }),
    sku:         faker.string.alphanumeric(8).toUpperCase(),
    tags:        faker.helpers.arrayElements(
      ['sale', 'new', 'popular', 'featured', 'limited', 'bestseller'],
      faker.number.int({ min: 1, max: 3 })
    ),
    images:      [
      {
        url:       `https://picsum.photos/seed/${faker.string.alphanumeric(6)}/600/600`,
        public_id: null,
      },
    ],
    isFeatured:  faker.datatype.boolean({ probability: 0.25 }),
    isPublished: true,
  }));
}

function buildCoupons() {
  const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days from now

  return [
    {
      code:          'WELCOME10',
      type:          'percentage',
      discount:      10,
      minOrderValue: 0,
      maxDiscount:   50,
      usageLimit:    null,
      userLimit:     1,
      expiryDate:    future,
      isActive:      true,
      description:   '10% off your first order',
    },
    {
      code:          'SAVE50',
      type:          'fixed',
      discount:      50,
      minOrderValue: 200,
      usageLimit:    500,
      userLimit:     1,
      expiryDate:    future,
      isActive:      true,
      description:   '$50 off orders over $200',
    },
    {
      code:          'SUMMER20',
      type:          'percentage',
      discount:      20,
      minOrderValue: 100,
      maxDiscount:   100,
      usageLimit:    1000,
      userLimit:     2,
      expiryDate:    future,
      isActive:      true,
      description:   '20% summer sale (max $100 off)',
    },
    {
      code:          'FLASH5',
      type:          'fixed',
      discount:      5,
      minOrderValue: 30,
      usageLimit:    200,
      userLimit:     1,
      expiryDate:    future,
      isActive:      true,
      description:   '$5 flash discount',
    },
  ];
}

// ── Core seed function (exported for use by resetDatabase --seed) ─────────────

async function run() {
  // Load models (safe to call after mongoose.connect())
  const User     = require('../src/models/User');
  const Category = require('../src/models/Category');
  const Product  = require('../src/models/Product');
  const Coupon   = require('../src/models/Coupon');
  const Cart     = require('../src/models/Cart');
  const Order    = require('../src/models/Order');
  const Review   = require('../src/models/Review');
  const Wishlist = require('../src/models/Wishlist');

  // ── Load faker (optional dev dependency) ─────────────────────────────────
  let faker;
  try {
    const { faker: f } = require('@faker-js/faker');
    faker = f;
  } catch {
    fail('@faker-js/faker is not installed. Run: npm install -D @faker-js/faker');
    throw new Error('Missing @faker-js/faker');
  }

  faker.seed(42); // Deterministic output for reproducibility

  // ── Clear existing data ───────────────────────────────────────────────────
  if (!NO_CLEAR) {
    section('Clearing existing data');
    await Promise.all([
      User.deleteMany({}),
      Category.deleteMany({}),
      Product.deleteMany({}),
      Coupon.deleteMany({}),
      Cart.deleteMany({}),
      Order.deleteMany({}),
      Review.deleteMany({}),
      Wishlist.deleteMany({}),
    ]);
    log('All collections cleared.');
  }

  if (DESTROY_ONLY) {
    ok('Destroy-only flag set — skipping seed.');
    return;
  }

  // ── 1. Categories (top-level first) ──────────────────────────────────────
  section('Seeding categories');

  const topLevelCategories = await Category.insertMany(buildCategories());

  // Build name → doc lookup for sub-categories
  const parentMap = {};
  topLevelCategories.forEach((c) => { parentMap[c.name] = c._id; });

  const subCategories = await Category.insertMany(buildSubCategories(parentMap));

  const allCategories = [...topLevelCategories, ...subCategories];
  log(`Created ${allCategories.length} categories (${topLevelCategories.length} top-level, ${subCategories.length} sub).`);

  // ── 2. Users ──────────────────────────────────────────────────────────────
  section('Seeding users');

  const baseUsers  = buildUsers();
  const fakeUsers  = buildFakeUsers(faker, 7);
  const allUserData = [...baseUsers, ...fakeUsers];

  // Use User.create() (NOT insertMany) — triggers the pre-save password hash hook
  const users = await User.create(allUserData);

  const adminUser  = users.find((u) => u.email === 'admin@test.com');
  const sellerUser = users.find((u) => u.email === 'seller@test.com');
  const testUser   = users.find((u) => u.email === 'user@test.com');

  log(`Created ${users.length} users:`);
  log(`  admin@test.com  / Admin123!   (admin)`);
  log(`  seller@test.com / Seller123!  (seller)`);
  log(`  user@test.com   / User1234!   (user)`);
  log(`  + ${fakeUsers.length} random users`);

  // ── 3. Products ───────────────────────────────────────────────────────────
  section('Seeding products');

  const productData = buildProducts(faker, allCategories, sellerUser._id);
  const products    = await Product.create(productData); // create() triggers pre-save (slug)

  log(`Created ${products.length} products.`);

  // ── 4. Coupons ────────────────────────────────────────────────────────────
  section('Seeding coupons');

  const coupons = await Coupon.insertMany(buildCoupons());
  log(`Created ${coupons.length} coupons: ${coupons.map((c) => c.code).join(', ')}.`);

  // ── 5. Sample reviews (3 per featured product) ────────────────────────────
  section('Seeding reviews');

  const regularUsers  = users.filter((u) => u.role === 'user');
  const reviewTargets = products.filter((p) => p.isFeatured).slice(0, 5);
  let   reviewCount   = 0;

  for (const product of reviewTargets) {
    const reviewers = faker.helpers.arrayElements(regularUsers, Math.min(3, regularUsers.length));

    for (const reviewer of reviewers) {
      await Review.create({
        product:    product._id,
        user:       reviewer._id,
        rating:     faker.number.int({ min: 3, max: 5 }),
        title:      faker.helpers.arrayElement([
          'Great product!',
          'Highly recommended',
          'Very satisfied',
          'Good value for money',
          'Exceeded expectations',
        ]),
        comment:    faker.lorem.sentences(3),
        isVerified: false,
      });
      reviewCount++;
    }
  }

  log(`Created ${reviewCount} reviews across ${reviewTargets.length} products.`);

  // ── 6. Sample wishlists ───────────────────────────────────────────────────
  section('Seeding wishlists');

  const wishlistProducts = faker.helpers.arrayElements(products, 5).map((p) => p._id);
  await Wishlist.create({ user: testUser._id, products: wishlistProducts });

  log(`Created 1 wishlist for test user with ${wishlistProducts.length} items.`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n  ══════════════════════════════════════\n');
  console.log('   Seed Summary');
  console.log('  ══════════════════════════════════════\n');
  log(`Categories : ${allCategories.length}`);
  log(`Users      : ${users.length}`);
  log(`Products   : ${products.length}`);
  log(`Coupons    : ${coupons.length}`);
  log(`Reviews    : ${reviewCount}`);
  log(`Wishlists  : 1\n`);
}

// ── Standalone entry point ────────────────────────────────────────────────────

async function main() {
  console.log('\n  ══════════════════════════════════════');
  console.log('   Database Seeder — E-Commerce Backend');
  console.log('  ══════════════════════════════════════\n');

  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is not set.');
    process.exit(1);
  }

  log('Connecting to MongoDB...');
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    log('Connected.\n');
  } catch (err) {
    fail(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }

  await run();

  ok('Seeding complete!');

  await mongoose.disconnect();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────

if (STANDALONE) {
  main().catch((err) => {
    fail(`Unexpected error: ${err.message}`);
    console.error(err.stack);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}

module.exports = { run };