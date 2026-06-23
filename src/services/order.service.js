'use strict';

/**
 * services/order.service.js — Order Business Logic
 * ==================================================
 * Stock validation, price calculation, order item building,
 * and atomic stock decrement / restore.
 *
 * All monetary calculations use Math.round to avoid floating-point drift.
 */

const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const logger   = require('../utils/logger');
const {
  TAX_RATE,
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_COST,
} = require('../utils/constants');

// Lazy-load event emitter to avoid circular dep at module load time
const getProductEmitter = () => require('../events/product.events');

// ── validateStock ─────────────────────────────────────────────────────────────

/**
 * Validate that all requested products exist and have sufficient stock.
 * Returns a result object — never throws — so the controller can return
 * a structured 400 with per-item details.
 *
 * @param  {Array<{ product: string, quantity: number }>} items
 * @returns {Promise<{
 *   valid:       boolean,
 *   outOfStock:  Array<{ productId, name, available, requested }>,
 *   products:    ProductDocument[]
 * }>}
 */
async function validateStock(items) {
  const productIds = items.map((i) => i.product || i.productId);

  const products = await Product.find({
    _id:         { $in: productIds },
    isPublished: true,
  });

  // Build a quick lookup map: productId → product document
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const outOfStock = [];
  const orderedProducts = [];

  for (const item of items) {
    const id      = (item.product || item.productId).toString();
    const product = productMap.get(id);
    const qty     = item.quantity;

    if (!product) {
      outOfStock.push({
        productId: id,
        name:      'Unknown product',
        available: 0,
        requested: qty,
      });
      continue;
    }

    if (product.stock < qty) {
      outOfStock.push({
        productId: id,
        name:      product.name,
        available: product.stock,
        requested: qty,
      });
    }

    orderedProducts.push(product);
  }

  return {
    valid:      outOfStock.length === 0,
    outOfStock,
    products:   orderedProducts,
  };
}

// ── buildOrderItems ───────────────────────────────────────────────────────────

/**
 * Build the order items array — snapshots name, image, and price from the
 * product document at the time of purchase.
 *
 * IMPORTANT: prices are ALWAYS taken from the product DB document, never
 * from the client's request body.
 *
 * @param  {Array<{ product: string, quantity: number }>} items — original request items
 * @param  {ProductDocument[]} products — fetched product docs (same order as items)
 * @returns {Array<OrderItem>}
 */
function buildOrderItems(items, products) {
  return items.map((item, i) => {
    const product = products[i];
    const price   = product.price;
    const qty     = item.quantity;

    return {
      product:  product._id,
      name:     product.name,
      image:    product.images?.[0]?.url || '',
      price,
      quantity: qty,
      subtotal: Math.round(price * qty * 100) / 100,
    };
  });
}

// ── calculateOrderTotals ──────────────────────────────────────────────────────

/**
 * Calculate all pricing components server-side.
 * All values rounded to 2 decimal places.
 *
 * @param  {Array<{ product: ProductDocument, quantity: number }>} items
 * @param  {CouponDocument|null} couponDoc
 * @param  {object}              _shippingAddress — reserved for region-based shipping
 * @returns {{
 *   itemsPrice:     number,
 *   shippingPrice:  number,
 *   taxPrice:       number,
 *   discountAmount: number,
 *   totalPrice:     number
 * }}
 */
function calculateOrderTotals(items, couponDoc = null) {
  const round2 = (n) => Math.round(n * 100) / 100;

  const itemsPrice = round2(
    items.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0)
  );

  const shippingPrice = itemsPrice >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;

  const taxPrice = round2(itemsPrice * TAX_RATE);

  const discountAmount = couponDoc
    ? round2(couponDoc.calculateDiscount(itemsPrice))
    : 0;

  const totalPrice = round2(
    itemsPrice + shippingPrice + taxPrice - discountAmount
  );

  return { itemsPrice, shippingPrice, taxPrice, discountAmount, totalPrice };
}

// ── decrementStock ────────────────────────────────────────────────────────────

/**
 * Decrement stock and increment sold count for each order item.
 * Must be called inside a Mongoose session so stock changes are atomic
 * with the order document creation.
 *
 * Emits 'product.outOfStock' event for any item whose stock hits 0.
 *
 * @param  {Array<{ product: ObjectId, quantity: number }>} orderItems
 * @param  {mongoose.ClientSession} [session]
 * @returns {Promise<void>}
 */
async function decrementStock(orderItems, session) {
  const ops = orderItems.map(async (item) => {
    const updated = await Product.findByIdAndUpdate(
      item.product,
      {
        $inc: {
          stock: -item.quantity,
          sold:  +item.quantity,
        },
      },
      { new: true, session }
    );

    // Emit out-of-stock event (non-blocking, outside the session)
    if (updated && updated.stock === 0) {
      setImmediate(() => {
        getProductEmitter().emit('product.outOfStock', { product: updated });
      });
    }
  });

  await Promise.all(ops);

  logger.debug('Stock decremented', {
    items: orderItems.map((i) => ({
      product:  i.product,
      quantity: i.quantity,
    })),
  });
}

// ── restoreStock ──────────────────────────────────────────────────────────────

/**
 * Restore stock and decrement sold count after an order cancellation.
 * No session required — cancellations happen outside the original transaction.
 *
 * @param  {Array<{ product: ObjectId, quantity: number }>} orderItems
 * @returns {Promise<void>}
 */
async function restoreStock(orderItems) {
  const ops = orderItems.map((item) =>
    Product.findByIdAndUpdate(item.product, {
      $inc: {
        stock: +item.quantity,
        sold:  -item.quantity,
      },
    })
  );

  await Promise.all(ops);

  logger.debug('Stock restored', {
    items: orderItems.map((i) => ({
      product:  i.product,
      quantity: i.quantity,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  validateStock,
  buildOrderItems,
  calculateOrderTotals,
  decrementStock,
  restoreStock,
};