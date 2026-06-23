"use strict";

/**
 * services/payment.service.js — Stripe Payment Service
 * =======================================================
 * Encapsulates all Stripe SDK calls so controllers never import Stripe directly.
 * Amounts are in dollars internally — converted to cents (×100) before Stripe calls.
 */

const Stripe = require("stripe");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

// ── Stripe client ─────────────────────────────────────────────────────────────

if (!process.env.STRIPE_SECRET_KEY) {
  logger.warn(
    "STRIPE_SECRET_KEY is not set — payment features will be unavailable",
  );
}

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_test_placeholder",
  {
    apiVersion: "2023-10-16",
    maxNetworkRetries: 3, // Automatic retry for transient network errors
    timeout: 30_000, // 30 s — Stripe SLA is typically <10 s
  },
);

// ── createPaymentIntent ───────────────────────────────────────────────────────

/**
 * Create a Stripe PaymentIntent and return the client secret for the frontend.
 *
 * @param  {number} amountDollars  — order total in dollars (e.g. 59.99)
 * @param  {string} [currency='usd']
 * @param  {object} [metadata={}]  — key-value pairs stored on the intent (orderId, userId)
 * @returns {Promise<{ clientSecret: string, paymentIntentId: string }>}
 */
async function createPaymentIntent(
  amountDollars,
  currency = "usd",
  metadata = {},
) {
  try {
    // Stripe requires amounts in the smallest currency unit (cents for USD)
    const amountCents = Math.round(amountDollars * 100);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency,
        metadata: {
          ...metadata,
        },
        // Accept all payment methods configured in the Stripe dashboard
        automatic_payment_methods: { enabled: true },
        // Optional: description appears in the Stripe dashboard
        description: metadata.orderNum
          ? `Order #${metadata.orderNum}`
          : "E-commerce purchase",
      },
      {
        // Idempotency key: safe to retry without creating duplicate intents
        idempotencyKey: `pi_order_${metadata.orderId || Date.now()}`,
      },
    );

    logger.debug("PaymentIntent created", {
      paymentIntentId: paymentIntent.id,
      amountCents,
      currency,
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (err) {
    logger.error("Stripe createPaymentIntent failed", {
      error: err.message,
      rawCode: err.raw?.code,
    });
    throw new AppError(
      err.raw?.message || "Payment initialisation failed. Please try again.",
      502,
    );
  }
}

// ── refundPayment ─────────────────────────────────────────────────────────────

/**
 * Issue a full or partial refund for a PaymentIntent.
 *
 * @param  {string} paymentIntentId — Stripe PaymentIntent ID (pi_...)
 * @param  {number} [amountDollars] — partial refund amount; omit for full refund
 * @returns {Promise<Stripe.Refund>}
 */
async function refundPayment(paymentIntentId, amountDollars) {
  try {
    const refundParams = {
      payment_intent: paymentIntentId,
    };

    // Partial refund: convert dollars → cents; undefined = full refund
    if (amountDollars !== undefined) {
      refundParams.amount = Math.round(amountDollars * 100);
    }

    const refund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `refund_${paymentIntentId}_${Date.now()}`,
    });

    logger.info("Stripe refund issued", {
      refundId: refund.id,
      paymentIntentId,
      amount: refund.amount,
      status: refund.status,
    });

    return refund;
  } catch (err) {
    logger.error("Stripe refundPayment failed", {
      paymentIntentId,
      error: err.message,
      rawCode: err.raw?.code,
    });
    throw new AppError(
      err.raw?.message || "Refund failed. Please try again or contact support.",
      502,
    );
  }
}

// ── constructWebhookEvent ─────────────────────────────────────────────────────

/**
 * Verify and construct a Stripe webhook event from the raw request body.
 * Throws if the signature is invalid — let it propagate to payment.controller.
 *
 * Requires express.raw() body parser (mounted in app.js before express.json).
 *
 * @param  {Buffer} rawBody       — req.body (Buffer, NOT parsed JSON)
 * @param  {string} signature     — req.headers['stripe-signature']
 * @param  {string} webhookSecret — process.env.STRIPE_WEBHOOK_SECRET
 * @returns {Stripe.Event}
 */
function constructWebhookEvent(rawBody, signature, webhookSecret) {
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

// ── retrievePaymentIntent ─────────────────────────────────────────────────────

/**
 * Retrieve the current state of a PaymentIntent from Stripe.
 * Useful for reconciliation or manual verification.
 *
 * @param  {string} paymentIntentId
 * @returns {Promise<Stripe.PaymentIntent>}
 */
async function retrievePaymentIntent(paymentIntentId) {
  try {
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    logger.error("Stripe retrievePaymentIntent failed", {
      paymentIntentId,
      error: err.message,
    });
    throw new AppError("Failed to retrieve payment details.", 502);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createPaymentIntent,
  refundPayment,
  constructWebhookEvent,
  retrievePaymentIntent,
};
