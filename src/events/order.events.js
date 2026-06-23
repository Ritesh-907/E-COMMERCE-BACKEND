"use strict";

/**
 * events/order.events.js — Order Domain Event Emitter
 * =====================================================
 * Decouples order side-effects from controllers.
 * Controllers emit events; listeners delegate to services.
 *
 * Events:
 *   order.created       — new order placed
 *   order.paid          — payment confirmed (via Stripe webhook)
 *   order.statusUpdated — admin changed order status
 *   order.cancelled     — order cancelled by user or admin
 */

const { EventEmitter } = require("events");
const { getIO } = require("../sockets");
const logger = require("../utils/logger");
const { NOTIFICATION_TYPE } = require("../utils/enums");

// ── Lazy imports ──────────────────────────────────────────────────────────────
// Services are imported lazily inside handlers to break circular dependency
// chains (e.g. order.service → order.events → email.job → email.service)
// and to ensure all modules are fully initialised before first use.

const getNotificationService = () =>
  require("../services/notification.service");
const getAddEmailJob = () => require("../jobs/email.job").addEmailJob;

// ── Emitter instance ──────────────────────────────────────────────────────────

const orderEmitter = new EventEmitter();

// Raise the default limit (10) — we register multiple listeners across events.
// Set it high enough to silence Node's memory-leak warning without actually
// leaking (all listeners below are intentional singletons).
orderEmitter.setMaxListeners(20);

// ── order.created ─────────────────────────────────────────────────────────────
// Fired by: order.controller.js → createOrder

orderEmitter.on("order.created", async ({ order, user }) => {
  try {
    // Queue confirmation email (non-blocking; 3 automatic retries via Bull)
    await getAddEmailJob()("orderReceived", user.email, { user, order });
  } catch (err) {
    logger.error("order.created: email job failed", {
      orderId: order._id,
      error: err.message,
    });
  }

  try {
    await getNotificationService().createNotification({
      userId: user._id,
      type: NOTIFICATION_TYPE.ORDER,
      title: "Order Received",
      message: `We received your order #${order.orderNumber}. Waiting for payment.`,
      link: `/orders/${order._id}`,
      metadata: { orderId: order._id },
    });
  } catch (err) {
    logger.error("order.created: notification failed", {
      orderId: order._id,
      error: err.message,
    });
  }
  try {
    const User = require("../models/User");
    const admins = await User.find({ role: "admin", isActive: true })
      .select("_id email name")
      .lean();

    // In-app notification for each admin
    await Promise.allSettled(
      admins.map((admin) =>
        getNotificationService().createNotification({
          userId: admin._id,
          type: NOTIFICATION_TYPE.ORDER,
          title: "🛒 New Order Received",
          message: `${user.name} placed order #${order.orderNumber} — $${order.totalPrice.toFixed(2)}`,
          link: `/admin/orders/${order._id}`,
          metadata: { orderId: order._id, amount: order.totalPrice },
        }),
      ),
    );
  } catch (err) {
    logger.error("order.created: admin notification failed", {
      error: err.message,
    });
  }

  // ── ADD THIS: notify the seller of the product ────────────────────────
  try {
    const Product = require("../models/Product");
    const User = require("../models/User");

    // Get unique seller IDs from all items in this order
    const productIds = order.items.map((item) => item.product);

    const products = await Product.find({ _id: { $in: productIds } })
      .select("seller name")
      .lean();

    // Build a map: sellerId → list of products they sold in this order
    const sellerProductsMap = {};
    products.forEach((p) => {
      if (!p.seller) return;
      const sellerId = p.seller.toString();
      if (!sellerProductsMap[sellerId]) sellerProductsMap[sellerId] = [];
      sellerProductsMap[sellerId].push(p.name);
    });

    // Notify each seller separately
    for (const [sellerId, productNames] of Object.entries(sellerProductsMap)) {
      const seller = await User.findById(sellerId)
        .select("_id name email")
        .lean();
      if (!seller) continue;

      const productList = productNames.join(", ");

      // In-app notification
      await getNotificationService().createNotification({
        userId: seller._id,
        type: NOTIFICATION_TYPE.ORDER,
        title: "💰 You have a new sale!",
        message: `${user.name} ordered: ${productList} — Order #${order.orderNumber}`,
        link: `/seller/orders/${order._id}`,
        metadata: { orderId: order._id, products: productNames },
      });
    }
  } catch (err) {
    logger.error("order.created: seller notification failed", {
      error: err.message,
    });
  }
});

// ── order.paid ────────────────────────────────────────────────────────────────
// Fired by: payment.controller.js → handleWebhook (payment_intent.succeeded)
// Note: user may not be available on req at this point — fetch from order

orderEmitter.on("order.paid", async ({ order }) => {
  // Fetch the user so we can address the notification correctly.
  // Use a try block so a missing user doesn't block the whole handler.
  let user;
  try {
    const User = require("../models/User");
    user = await User.findById(order.user).select("name email").lean();
  } catch (err) {
    logger.error("order.paid: failed to fetch user", {
      orderId: order._id,
      error: err.message,
    });
    return;
  }

  if (!user) {
    logger.warn("order.paid: user not found — skipping notification", {
      orderId: order._id,
      userId: order.user,
    });
    return;
  }
  try {
    getIO()
      .to("admin-room")
      .emit("notification:new", {
        type: "order",
        title: "🛒 New Paid Order",
        message: `Order ${order.orderNumber} • ${order.totalPrice}`,
        orderId: order._id,
        createdAt: new Date(),
        link: `/admin/orders/${order._id}`,
      });

    logger.info("Admin order notification broadcast", {
      orderId: order._id,
    });
  } catch (err) {
    logger.error("Socket broadcast failed", {
      orderId: order._id,
      error: err.message,
    });
  }
  try {
    await getNotificationService().createNotification({
      userId: user._id,
      type: NOTIFICATION_TYPE.ORDER,
      title: "Payment Confirmed",
      message: `Payment for order #${order.orderNumber} was successful. We're preparing your order.`,
      link: `/orders/${order._id}`,
      metadata: { orderId: order._id },
    });
  } catch (err) {
    logger.error("order.paid: notification failed", {
      orderId: order._id,
      error: err.message,
    });
  }

  try {
    await getAddEmailJob()("orderConfirm", user.email, { user, order });
  } catch (err) {
    logger.error("order.paid: email job failed", {
      orderId: order._id,
      error: err.message,
    });
  }
});

// ── order.statusUpdated ───────────────────────────────────────────────────────
// Fired by: order.controller.js → updateOrderStatus, addTrackingNumber

orderEmitter.on("order.statusUpdated", async ({ order }) => {
  let user;
  try {
    const User = require("../models/User");
    user = await User.findById(order.user).select("name email").lean();
  } catch (err) {
    logger.error("order.statusUpdated: failed to fetch user", {
      orderId: order._id,
      error: err.message,
    });
    return;
  }

  if (!user) return;

  // Build human-friendly status message
  const statusMessages = {
    processing: `Your order #${order.orderNumber} is being processed.`,
    shipped: `Your order #${order.orderNumber} has been shipped.${order.trackingNumber ? ` Tracking: ${order.trackingNumber}.` : ""}`,
    delivered: `Your order #${order.orderNumber} has been delivered. Enjoy!`,
    cancelled: `Your order #${order.orderNumber} has been cancelled.`,
  };

  const message =
    statusMessages[order.orderStatus] ||
    `Your order #${order.orderNumber} status changed to "${order.orderStatus}".`;

  try {
    await getNotificationService().createNotification({
      userId: user._id,
      type: NOTIFICATION_TYPE.ORDER,
      title: `Order ${capitalise(order.orderStatus)}`,
      message,
      link: `/orders/${order._id}`,
      metadata: { orderId: order._id, status: order.orderStatus },
    });
  } catch (err) {
    logger.error("order.statusUpdated: notification failed", {
      orderId: order._id,
      error: err.message,
    });
  }

  try {
    await getAddEmailJob()("orderStatus", user.email, { user, order });
  } catch (err) {
    logger.error("order.statusUpdated: email job failed", {
      orderId: order._id,
      error: err.message,
    });
  }
});

// ── order.cancelled ───────────────────────────────────────────────────────────
// Fired by: order.controller.js → cancelOrder

orderEmitter.on("order.cancelled", async ({ order, user }) => {
  // user is always passed by cancelOrder controller
  try {
    await getNotificationService().createNotification({
      userId: user._id,
      type: NOTIFICATION_TYPE.ORDER,
      title: "Order Cancelled",
      message: `Your order #${order.orderNumber} has been cancelled.${
        order.paymentStatus === "refunded"
          ? " A refund has been initiated."
          : ""
      }`,
      link: `/orders/${order._id}`,
      metadata: { orderId: order._id },
    });
  } catch (err) {
    logger.error("order.cancelled: notification failed", {
      orderId: order._id,
      error: err.message,
    });
  }

  // Only send a refund email if payment was actually refunded
  if (order.paymentStatus === "refunded") {
    try {
      await getAddEmailJob()("orderStatus", user.email, { user, order });
    } catch (err) {
      logger.error("order.cancelled: refund email job failed", {
        orderId: order._id,
        error: err.message,
      });
    }
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = orderEmitter;
