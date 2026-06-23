"use strict";

/**
 * services/email.service.js — Transactional Email Service
 * ==========================================================
 * Sends all app emails via Nodemailer with inline-styled HTML templates.
 * Emails are queued via email.job.js (Bull) — never call this directly
 * from controllers; use addEmailJob() instead so failures don't block requests.
 *
 * Functions exported:
 *   sendVerificationEmail(user, rawToken)
 *   sendPasswordResetEmail(user, rawToken)
 *   sendOrderConfirmation(user, order)
 *   sendOrderStatusUpdate(user, order)
 *   sendWelcomeEmail(user)
 *   sendLowStockAlert(adminEmail, products)
 *   sendSecurityAlertEmail(user, action, note)
 *   sendAccountDeactivatedEmail(user)
 */

const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

// ── Constants ─────────────────────────────────────────────────────────────────

const STORE_NAME = "MyStore";
const BRAND_COLOR = "#4F46E5"; // indigo-600
const FROM = `"${STORE_NAME}" <${process.env.EMAIL_FROM || "noreply@mystore.com"}>`;

// ── Transporter ───────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465, // true for port 465, false otherwise
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Base sender ───────────────────────────────────────────────────────────────

/**
 * Core send function. Wraps transporter.sendMail and logs the outcome.
 * All other functions in this module call this.
 *
 * @param {{ to: string, subject: string, html: string }} options
 */
async function sendEmail({ to, subject, html }) {
  const info = await transporter.sendMail({ from: FROM, to, subject, html });
  logger.info("Email sent", { to, subject, messageId: info.messageId });
  return info;
}

// ── HTML Template builder ─────────────────────────────────────────────────────

/**
 * Wraps content in a consistent branded email shell.
 * Uses inline CSS — most email clients strip <style> tags.
 *
 * @param {string}  title    — preheader / heading text
 * @param {string}  body     — inner HTML (paragraphs, tables, etc.)
 * @param {string}  [ctaUrl]   — optional call-to-action URL
 * @param {string}  [ctaText]  — optional call-to-action button label
 */
function buildTemplate(title, body, ctaUrl = null, ctaText = null) {
  const ctaBlock = ctaUrl
    ? `
      <tr>
        <td align="center" style="padding: 24px 0 8px;">
          <a href="${ctaUrl}"
             style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;
                    font-family:Arial,sans-serif;font-size:15px;font-weight:bold;
                    text-decoration:none;padding:14px 32px;border-radius:6px;">
            ${ctaText}
          </a>
        </td>
      </tr>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;
                      box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">
                ${STORE_NAME}
              </span>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <h1 style="margin:0;font-size:22px;color:#111827;">${title}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 0;color:#374151;font-size:15px;line-height:1.7;">
              ${body}
            </td>
          </tr>

          <!-- CTA -->
          ${ctaBlock}

          <!-- Footer -->
          <tr>
            <td style="padding:32px 40px;text-align:center;border-top:1px solid #e5e7eb;
                       color:#9ca3af;font-size:12px;line-height:1.6;">
              &copy; ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.<br/>
              If you have questions, contact us at
              <a href="mailto:${process.env.EMAIL_FROM}" style="color:${BRAND_COLOR};">
                ${process.env.EMAIL_FROM || "support@mystore.com"}
              </a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a price number to currency string e.g. 1500 → "$1,500.00" */
function formatPrice(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount,
  );
}

// ── Email functions ───────────────────────────────────────────────────────────

/**
 * Send email verification link to a newly registered user.
 *
 * @param {{ name: string, email: string }} user
 * @param {string} rawToken — plain token (not hashed)
 */
async function sendVerificationEmail(user, rawToken) {
  try {
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email/${rawToken}`;

    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>Thanks for signing up! Please verify your email address to activate your account.</p>
      <p>This link will expire in <strong>24 hours</strong>.</p>
      <p style="font-size:13px;color:#6b7280;">
        If you didn't create an account with ${STORE_NAME}, you can safely ignore this email.
      </p>`;

    await sendEmail({
      to: user.email,
      subject: "Verify your email address",
      html: buildTemplate(
        "Verify Your Email",
        body,
        verifyUrl,
        "Verify Email Address",
      ),
    });
  } catch (err) {
    logger.error("sendVerificationEmail failed", {
      to: user.email,
      error: err.message,
    });
  }
}

/**
 * Send password reset link.
 *
 * @param {{ name: string, email: string }} user
 * @param {string} rawToken
 */
async function sendPasswordResetEmail(user, rawToken) {
  try {
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;

    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>We received a request to reset your password. Click the button below to choose a new one.</p>
      <p>This link will expire in <strong>10 minutes</strong>.</p>
      <p style="font-size:13px;color:#6b7280;">
        If you didn't request a password reset, you can safely ignore this email —
        your password will not be changed.
      </p>`;

    await sendEmail({
      to: user.email,
      subject: "Password reset request",
      html: buildTemplate(
        "Reset Your Password",
        body,
        resetUrl,
        "Reset Password",
      ),
    });
  } catch (err) {
    logger.error("sendPasswordResetEmail failed", {
      to: user.email,
      error: err.message,
    });
  }
}

/**
 * Send order confirmation after a successful purchase.
 *
 * @param {{ name: string, email: string }} user
 * @param {{ orderNumber, items, shippingAddress, totalPrice, estimatedDelivery }} order
 */
async function sendOrderConfirmation(user, order) {
  try {
    const itemRows = (order.items || [])
      .map(
        (item) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;color:#374151;">
            ${item.product?.name || item.name || "Product"}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">
            ${item.quantity}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
            ${formatPrice(item.price)}
          </td>
        </tr>`,
      )
      .join("");

    const addr = order.shippingAddress || {};

    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>We've received your order and it's being processed. Here's your summary:</p>

      <table width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background-color:#f9fafb;">
            <th style="padding:10px 8px;text-align:left;font-size:13px;color:#6b7280;font-weight:600;">Item</th>
            <th style="padding:10px 8px;text-align:center;font-size:13px;color:#6b7280;font-weight:600;">Qty</th>
            <th style="padding:10px 8px;text-align:right;font-size:13px;color:#6b7280;font-weight:600;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr>
            <td colspan="2" style="padding:12px 8px;text-align:right;font-weight:bold;color:#111827;">Total</td>
            <td style="padding:12px 8px;text-align:right;font-weight:bold;color:${BRAND_COLOR};">
              ${formatPrice(order.totalPrice)}
            </td>
          </tr>
        </tbody>
      </table>

      <p><strong>Shipping to:</strong><br/>
        ${addr.street || ""}, ${addr.city || ""}, ${addr.state || ""} ${addr.postalCode || ""}, ${addr.country || ""}
      </p>
      ${
        order.estimatedDelivery
          ? `<p><strong>Estimated Delivery:</strong> ${order.estimatedDelivery}</p>`
          : ""
      }
      <p style="font-size:13px;color:#6b7280;">Order #: ${order.orderNumber}</p>`;

    await sendEmail({
      to: user.email,
      subject: `Order Confirmed — ${order.orderNumber}`,
      html: buildTemplate("Order Confirmed! 🎉", body),
    });
  } catch (err) {
    logger.error("sendOrderConfirmation failed", {
      to: user.email,
      error: err.message,
    });
  }
}

/**
 * Notify user of an order status change (e.g. shipped, delivered).
 *
 * @param {{ name: string, email: string }} user
 * @param {{ orderNumber, orderStatus, trackingNumber, estimatedDelivery }} order
 */
async function sendOrderStatusUpdate(user, order) {
  try {
    const statusLabel = (order.orderStatus || "Updated").replace(/_/g, " ");

    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>Your order <strong>#${order.orderNumber}</strong> has been updated.</p>

      <table cellpadding="0" cellspacing="0"
             style="background:#f9fafb;border-radius:6px;padding:16px;margin:16px 0;width:100%;">
        <tr>
          <td style="color:#6b7280;font-size:13px;padding:4px 0;">Order Status</td>
          <td style="font-weight:bold;color:#111827;text-align:right;text-transform:capitalize;">
            ${statusLabel}
          </td>
        </tr>
        ${
          order.trackingNumber
            ? `<tr>
              <td style="color:#6b7280;font-size:13px;padding:4px 0;">Tracking Number</td>
              <td style="font-weight:bold;color:#111827;text-align:right;">${order.trackingNumber}</td>
             </tr>`
            : ""
        }
        ${
          order.estimatedDelivery
            ? `<tr>
              <td style="color:#6b7280;font-size:13px;padding:4px 0;">Estimated Delivery</td>
              <td style="font-weight:bold;color:#111827;text-align:right;">${order.estimatedDelivery}</td>
             </tr>`
            : ""
        }
      </table>

      <p style="font-size:13px;color:#6b7280;">
        Questions about your order? Reply to this email or visit our support page.
      </p>`;

    await sendEmail({
      to: user.email,
      subject: `Order ${order.orderNumber} — Status Updated to ${statusLabel}`,
      html: buildTemplate(`Order Status: ${statusLabel}`, body),
    });
  } catch (err) {
    logger.error("sendOrderStatusUpdate failed", {
      to: user.email,
      error: err.message,
    });
  }
}

/**
 * Send a welcome email right after the user verifies their account.
 *
 * @param {{ name: string, email: string }} user
 */
async function sendWelcomeEmail(user) {
  try {
    const shopUrl = `${process.env.CLIENT_URL}/products`;

    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>Welcome to <strong>${STORE_NAME}</strong>! 🎉 Your account is verified and ready to go.</p>
      <p>Here's what you can do next:</p>
      <ul style="line-height:2;">
        <li>Browse our latest products</li>
        <li>Add items to your wishlist</li>
        <li>Use discount codes at checkout</li>
      </ul>
      <p style="font-size:13px;color:#6b7280;">
        Need help? Contact us at
        <a href="mailto:${process.env.EMAIL_FROM}" style="color:${BRAND_COLOR};">
          ${process.env.EMAIL_FROM || "support@mystore.com"}
        </a>
      </p>`;

    await sendEmail({
      to: user.email,
      subject: `Welcome to ${STORE_NAME}!`,
      html: buildTemplate(
        `Welcome, ${user.name}!`,
        body,
        shopUrl,
        "Start Shopping",
      ),
    });
  } catch (err) {
    logger.error("sendWelcomeEmail failed", {
      to: user.email,
      error: err.message,
    });
  }
}

/**
 * Alert admin(s) when products fall below minimum stock threshold.
 *
 * @param {string}   adminEmail
 * @param {Array<{ name: string, sku: string, stock: number, lowStockThreshold: number }>} products
 */
async function sendLowStockAlert(adminEmail, products) {
  try {
    const rows = (products || [])
      .map(
        (p) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;color:#374151;">${p.name}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;color:#374151;">${p.sku || "—"}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;
                     color:${p.stock === 0 ? "#dc2626" : "#d97706"};font-weight:bold;">
            ${p.stock}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">
            ${p.lowStockThreshold || 10}
          </td>
        </tr>`,
      )
      .join("");

    const body = `
      <p>The following products have fallen below their minimum stock threshold and require restocking:</p>

      <table width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background-color:#fef2f2;">
            <th style="padding:10px 8px;text-align:left;font-size:13px;color:#6b7280;">Product</th>
            <th style="padding:10px 8px;text-align:left;font-size:13px;color:#6b7280;">SKU</th>
            <th style="padding:10px 8px;text-align:center;font-size:13px;color:#6b7280;">Stock</th>
            <th style="padding:10px 8px;text-align:center;font-size:13px;color:#6b7280;">Threshold</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="font-size:13px;color:#6b7280;">
        Please log in to the admin dashboard to restock these items.
      </p>`;

    await sendEmail({
      to: adminEmail,
      subject: "Low Stock Alert — Action Required",
      html: buildTemplate("⚠️ Low Stock Alert", body),
    });
  } catch (err) {
    logger.error("sendLowStockAlert failed", {
      to: adminEmail,
      error: err.message,
    });
  }
}

/**
 * Notify user of a security-related action on their account
 * (e.g. password changed, new login from unknown device).
 *
 * @param {{ name: string, email: string }} user
 * @param {string} action — e.g. 'Password Changed', 'New Login Detected'
 * @param {string} [note] — optional extra detail shown in the email
 */
async function sendSecurityAlertEmail(user, action, note = "") {
  try {
    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>We noticed the following security activity on your account:</p>

      <table cellpadding="0" cellspacing="0"
             style="background:#fef2f2;border-radius:6px;padding:16px;margin:16px 0;width:100%;">
        <tr>
          <td style="color:#6b7280;font-size:13px;">Action</td>
          <td style="font-weight:bold;color:#dc2626;text-align:right;">${action}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;font-size:13px;padding-top:8px;">Time</td>
          <td style="font-weight:bold;color:#111827;text-align:right;padding-top:8px;">
            ${new Date().toUTCString()}
          </td>
        </tr>
        ${
          note
            ? `<tr>
              <td colspan="2" style="color:#374151;font-size:13px;padding-top:12px;">${note}</td>
             </tr>`
            : ""
        }
      </table>

      <p>
        If this was you, no action is needed. If you didn't do this,
        <strong>reset your password immediately</strong> and contact support.
      </p>`;

    await sendEmail({
      to: user.email,
      subject: `Security Alert: ${action}`,
      html: buildTemplate(`Security Alert: ${action}`, body),
    });
  } catch (err) {
    logger.error("sendSecurityAlertEmail failed", {
      to: user.email,
      error: err.message,
    });
  }
}

/**
 * Notify user that their account has been deactivated by an admin.
 *
 * @param {{ name: string, email: string }} user
 */
async function sendAccountDeactivatedEmail(user) {
  try {
    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>
      <p>
        Your ${STORE_NAME} account has been <strong>deactivated</strong>.
        If you believe this is a mistake, please contact our support team.
      </p>
      <p style="font-size:13px;color:#6b7280;">
        Email us at
        <a href="mailto:${process.env.EMAIL_FROM}" style="color:${BRAND_COLOR};">
          ${process.env.EMAIL_FROM || "support@mystore.com"}
        </a>
      </p>`;

    await sendEmail({
      to: user.email,
      subject: "Your account has been deactivated",
      html: buildTemplate("Account Deactivated", body),
    });
  } catch (err) {
    logger.error("sendAccountDeactivatedEmail failed", {
      to: user.email,
      error: err.message,
    });
  }
}
async function sendOrderReceived(user, order) {
  try {
    const itemRows = (order.items || [])
      .map(
        (item) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;color:#374151;">
            ${item.product?.name || item.name || "Product"}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">
            ${item.quantity}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
            ${formatPrice(item.price)}
          </td>
        </tr>`,
      )
      .join("");

    const addr = order.shippingAddress || {};

    const body = `
      <p>Hi <strong>${user.name}</strong>,</p>

      <p>
        Thank you for your order. We have successfully received it and are
        currently waiting for payment confirmation.
      </p>

      <div style="
        background:#fff7ed;
        border-left:4px solid #f59e0b;
        padding:12px;
        margin:16px 0;
        border-radius:6px;
      ">
        <strong>Payment Status:</strong> Pending
        <br />
        Your order will be confirmed once payment is successfully processed.
      </div>

      <table width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background-color:#f9fafb;">
            <th style="padding:10px 8px;text-align:left;font-size:13px;color:#6b7280;font-weight:600;">
              Item
            </th>
            <th style="padding:10px 8px;text-align:center;font-size:13px;color:#6b7280;font-weight:600;">
              Qty
            </th>
            <th style="padding:10px 8px;text-align:right;font-size:13px;color:#6b7280;font-weight:600;">
              Price
            </th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}

          <tr>
            <td colspan="2"
                style="padding:12px 8px;text-align:right;font-weight:bold;color:#111827;">
              Total
            </td>

            <td style="
              padding:12px 8px;
              text-align:right;
              font-weight:bold;
              color:${BRAND_COLOR};
            ">
              ${formatPrice(order.totalPrice)}
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>Shipping Address:</strong><br/>
        ${addr.street || ""},
        ${addr.city || ""},
        ${addr.state || ""},
        ${addr.postalCode || ""},
        ${addr.country || ""}
      </p>

      <p>
        <strong>Order Number:</strong>
        ${order.orderNumber}
      </p>

      <p style="margin-top:20px;">
        Once payment is confirmed, you'll receive another email with your
        official order confirmation and tracking updates.
      </p>

      <p style="font-size:13px;color:#6b7280;">
        If you did not place this order, please contact support immediately.
      </p>
    `;

    await sendEmail({
      to: user.email,
      subject: `Order Received — ${order.orderNumber}`,
      html: buildTemplate("Order Received 📦", body),
    });
  } catch (err) {
    logger.error("sendOrderReceived failed", {
      to: user.email,
      error: err.message,
    });
  }
}
// async function sendSellerSaleNotification(seller, order, soldItems) {
//   try {
//     const itemRows = (soldItems || [])
//       .map(
//         (item) => `
//         <tr>
//           <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;color:#374151;">
//             ${item.name}
//           </td>
//           <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">
//             ${item.quantity}
//           </td>
//           <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
//             ${formatPrice(item.price)}
//           </td>
//         </tr>`,
//       )
//       .join("");

//     const sellerRevenue = soldItems.reduce(
//       (sum, item) => sum + item.price * item.quantity,
//       0,
//     );

//     const body = `
//       <p>Hello ${seller.name},</p>

//       <p>
//         Congratulations! One or more of your products have been purchased.
//       </p>

//       <div style="
//         background:#eff6ff;
//         border-left:4px solid #3b82f6;
//         padding:12px;
//         margin:16px 0;
//         border-radius:6px;
//       ">
//         <strong>Order Number:</strong> ${order.orderNumber}<br/>
//         <strong>Your Revenue:</strong> ${formatPrice(sellerRevenue)}
//       </div>

//       <table width="100%" cellpadding="0" cellspacing="0"
//         style="border:1px solid #e5e7eb;border-collapse:collapse;margin:16px 0;">
//         <thead>
//           <tr style="background:#f9fafb;">
//             <th style="padding:10px;text-align:left;">Product</th>
//             <th style="padding:10px;text-align:center;">Qty</th>
//             <th style="padding:10px;text-align:right;">Price</th>
//           </tr>
//         </thead>
//         <tbody>
//           ${itemRows}
//         </tbody>
//       </table>

//       <p>
//         Please prepare these items for fulfillment.
//       </p>

//       <p>
//         Log in to your seller dashboard to manage this order.
//       </p>
//     `;

//     await sendEmail({
//       to: seller.email,
//       subject: `🎉 New Sale - ${order.orderNumber}`,
//       html: buildTemplate("New Sale Notification", body),
//     });
//   } catch (err) {
//     logger.error("sendSellerSaleNotification failed", {
//       sellerId: seller._id,
//       error: err.message,
//     });
//   }
// }
// async function sendNewOrderAdminAlert(order, customer) {
//   try {
//     const itemRows = (order.items || [])
//       .map(
//         (item) => `
//         <tr>
//           <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;color:#374151;">
//             ${item.name || item.product?.name || "Product"}
//           </td>
//           <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">
//             ${item.quantity}
//           </td>
//           <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
//             ${formatPrice(item.price)}
//           </td>
//         </tr>`,
//       )
//       .join("");

//     const address = order.shippingAddress || {};

//     const body = `
//       <p>Hello Admin,</p>

//       <p>
//         A new paid order has been received and is ready for processing.
//       </p>

//       <div style="
//         background:#ecfdf5;
//         border-left:4px solid #10b981;
//         padding:12px;
//         margin:16px 0;
//         border-radius:6px;
//       ">
//         <strong>Order Number:</strong> ${order.orderNumber}<br/>
//         <strong>Customer:</strong> ${customer.name}<br/>
//         <strong>Email:</strong> ${customer.email}<br/>
//         <strong>Total:</strong> ${formatPrice(order.totalPrice)}
//       </div>

//       <table width="100%" cellpadding="0" cellspacing="0"
//         style="border:1px solid #e5e7eb;border-collapse:collapse;margin:16px 0;">
//         <thead>
//           <tr style="background:#f9fafb;">
//             <th style="padding:10px;text-align:left;">Item</th>
//             <th style="padding:10px;text-align:center;">Qty</th>
//             <th style="padding:10px;text-align:right;">Price</th>
//           </tr>
//         </thead>
//         <tbody>
//           ${itemRows}
//         </tbody>
//       </table>

//       <p>
//         <strong>Shipping Address:</strong><br/>
//         ${address.street || ""}<br/>
//         ${address.city || ""}, ${address.state || ""}<br/>
//         ${address.country || ""} ${address.zip || ""}
//       </p>

//       <p>
//         Please review, pack, and ship this order.
//       </p>
//     `;

//     await sendEmail({
//       to: process.env.ADMIN_EMAIL,
//       subject: `🔔 New Paid Order - ${order.orderNumber}`,
//       html: buildTemplate("New Order Alert", body),
//     });
//   } catch (err) {
//     logger.error("sendNewOrderAdminAlert failed", {
//       orderId: order._id,
//       error: err.message,
//     });
//   }
// }
// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendWelcomeEmail,
  sendLowStockAlert,
  sendSecurityAlertEmail,
  sendAccountDeactivatedEmail,
  sendOrderReceived
};
