"use strict";

/**
 * controllers/payment.controller.js — Stripe Payment Handling
 * =============================================================
 * IMPORTANT:
 *  - createPaymentIntent and refundPayment use asyncHandler (JSON body)
 *  - handleWebhook does NOT use asyncHandler and uses raw body (express.raw)
 *    mounted BEFORE express.json in app.js
 */

const mongoose = require("mongoose");
const Order = require("../models/Order");
const paymentService = require("../services/payment.service");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { successResponse } = require("../utils/response");
const logger = require("../utils/logger");

// Lazy-load order event emitter to avoid circular deps at startup
const getOrderEmitter = () => require("../events/order.events");

// ── createPaymentIntent ───────────────────────────────────────────────────────

exports.createPaymentIntent = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!mongoose.isValidObjectId(orderId)) {
    throw new AppError("Invalid order ID.", 400);
  }

  // Always fetch the authoritative amount from DB — never trust client input
  const order = await Order.findOne({ _id: orderId, user: req.user._id });

  if (!order) throw new AppError("Order not found.", 404);

  if (order.isPaid) {
    throw new AppError("This order has already been paid.", 400);
  }

  if (order.orderStatus === "cancelled") {
    throw new AppError("Cannot process payment for a cancelled order.", 400);
  }

  const { clientSecret, paymentIntentId } =
    await paymentService.createPaymentIntent(order.totalPrice, "usd", {
      orderId: order._id.toString(),
      userId: req.user._id.toString(),
      orderNum: order.orderNumber,
      email_address:req.user.email
    });

  // Store the intent ID on the order so we can reference it in the webhook
  order.paymentResult = { id: paymentIntentId };
  await order.save({ validateBeforeSave: false });

  successResponse(res, { clientSecret, orderId: order._id });
});

// ── handleWebhook ─────────────────────────────────────────────────────────────
// !! Mounted with express.raw() — raw Buffer body, NOT parsed JSON !!
// !! Must respond 200 quickly — Stripe retries if no 200 within 30 s !!

exports.handleWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  // console.log("sign", signature);
  let event;

  try {
    event = paymentService.constructWebhookEvent(
      req.body,
      signature,
      webhookSecret,
    );
  } catch (err) {
    logger.error("Stripe webhook signature verification failed", {
      error: err.message,
    });
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  logger.info("Stripe webhook received", { type: event.type, id: event.id });

  // Respond immediately — process asynchronously to avoid Stripe timeout
  res.status(200).json({ received: true });

  // ── Process event (non-blocking) ───────────────────────────────────────────
  setImmediate(async () => {
    try {
      // console.log("ritu", event);
      const data = event.data.object;
      // console.log("ritesh", data);
      const meta = data.metadata || {};
      const orderId = meta.orderId;

      switch (event.type) {
        case "payment_intent.succeeded": {
          if (!orderId) break;

          const order = await Order.findByIdAndUpdate(
            orderId,
            {
              isPaid: true,
              paidAt: new Date(),
              paymentStatus: "paid",
              orderStatus: "processing", // auto-advance from pending
              paymentResult: {
                id: data.id,
                status: data.status,
                update_time: new Date().toISOString(),
                email_address: meta.email_address || "",
              },
            },
            { new: true },
          );

          if (order) {
            getOrderEmitter().emit("order.paid", { order });
            logger.info("Order marked as paid via webhook", { orderId });
          }
          break;
        }

        case "payment_intent.payment_failed": {
          if (!orderId) break;
          await Order.findByIdAndUpdate(orderId, { paymentStatus: "failed" });
          logger.warn("Payment failed", {
            orderId,
            reason: data.last_payment_error?.message,
          });
          break;
        }

        case "charge.refunded": {
          // charge.refunded carries the payment_intent ID, not orderId directly
          const paymentIntentId = data.payment_intent;
          if (!paymentIntentId) break;

          const order = await Order.findOneAndUpdate(
            { "paymentResult.id": paymentIntentId },
            { paymentStatus: "refunded" },
            { new: true },
          );

          if (order) {
            logger.info("Order marked as refunded via webhook", {
              orderId: order._id,
            });
          }
          break;
        }

        default:
          // Unhandled event types — log and ignore
          logger.debug("Unhandled Stripe event type", { type: event.type });
      }
    } catch (err) {
      // Log processing error but do NOT re-respond (already sent 200)
      logger.error("Stripe webhook processing error", {
        eventType: event.type,
        eventId: event.id,
        error: err.message,
        stack: err.stack,
      });
    }
  });
};

// ── refundPayment (admin) ─────────────────────────────────────────────────────

exports.refundPayment = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.orderId)) {
    throw new AppError("Invalid order ID.", 400);
  }

  const order = await Order.findById(req.params.orderId);
  if (!order) throw new AppError("Order not found.", 404);

  if (!order.isPaid) {
    throw new AppError(
      "This order has not been paid — nothing to refund.",
      400,
    );
  }

  if (order.paymentStatus === "refunded") {
    throw new AppError("This order has already been refunded.", 400);
  }

  if (!order.paymentResult?.id) {
    throw new AppError("No payment record found for this order.", 400);
  }

  // Partial refund if amount provided; full refund otherwise
  const refundAmount = req.body.amount
    ? parseFloat(req.body.amount)
    : undefined;

  const refund = await paymentService.refundPayment(
    order.paymentResult.id,
    refundAmount,
  );

  order.paymentStatus = "refunded";
  await order.save({ validateBeforeSave: false });

  logger.info("Manual refund issued by admin", {
    orderId: order._id,
    adminId: req.user._id,
    refundId: refund.id,
    amount: refundAmount || "full",
  });

  successResponse(res, { refund }, "Refund issued successfully.");
});
