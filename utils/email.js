const { Resend } = require("resend");
const { IntegrationSetting, Order, OrderItem, Product, Customer } = require("../models");
const { encrypt, decrypt } = require("./encryption");

const INTEGRATION_KEY = "resend";

// Reads Resend credentials from IntegrationSettings (config-driven,
// admin-panel-managed — same clone-ability reason as Shiprocket/Razorpay,
// see utils/shiprocket.js getCredentials()). Falls back to
// RESEND_API_KEY/RESEND_FROM_EMAIL/RESEND_REPLY_TO from .env only when no
// DB row exists yet (those env vars already exist for utils/mailer.js's OTP
// emails), and in that case persists them into the DB as a one-time seed —
// every call after that reads the DB. replyTo is optional everywhere (a
// verified sending domain doesn't require it) — sendEmail() below only
// attaches it when present.
async function getEmailCredentials() {
  const setting = await IntegrationSetting.findOne({ where: { integrationKey: INTEGRATION_KEY } });

  if (setting?.config?.apiKey && setting?.config?.fromEmail) {
    return {
      apiKey: decrypt(setting.config.apiKey),
      fromEmail: setting.config.fromEmail,
      replyTo: setting.config.replyTo || null,
    };
  }

  const envApiKey = process.env.RESEND_API_KEY;
  const envFromEmail = process.env.RESEND_FROM_EMAIL;
  const envReplyTo = process.env.RESEND_REPLY_TO || null;
  if (!envApiKey || !envFromEmail) {
    throw new Error(
      "Resend is not configured — set it up from the admin panel (Settings > Integrations > Resend), or set RESEND_API_KEY/RESEND_FROM_EMAIL in .env for first-time setup",
    );
  }

  const seededConfig = { apiKey: encrypt(envApiKey), fromEmail: envFromEmail, replyTo: envReplyTo };
  if (setting) {
    setting.config = seededConfig;
    await setting.save();
  } else {
    await IntegrationSetting.create({ integrationKey: INTEGRATION_KEY, config: seededConfig });
  }
  console.log("Resend credentials seeded into IntegrationSettings from .env");

  return { apiKey: envApiKey, fromEmail: envFromEmail, replyTo: envReplyTo };
}

// Generic transactional email sender — every order email below goes through
// this one function, same shared-entry-point pattern as
// authenticatedRequest() in utils/shiprocket.js. Throws on failure; callers
// that shouldn't ever let an email error interrupt their own flow (order
// creation, label generation, ...) are expected to catch/swallow it
// themselves — see sendOrderConfirmedEmail()/sendOrderPackedEmail() below,
// which already do this so most callers don't have to.
async function sendEmail(to, subject, htmlBody) {
  if (!to) {
    throw new Error("Recipient email is required");
  }

  const { apiKey, fromEmail, replyTo } = await getEmailCredentials();
  const client = new Resend(apiKey);
  const { error } = await client.emails.send({
    from: fromEmail,
    to,
    subject,
    html: htmlBody,
    ...(replyTo && { replyTo }),
  });

  if (error) {
    throw new Error(error.message || "Resend rejected the email");
  }
}

function formatCurrencyINR(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function buildOrderConfirmedHtml(order) {
  const itemsHtml = (order.OrderItems || [])
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 0; color:#2A2A28;">${item.Product?.name || "Product"}${item.weight ? ` (${item.weight})` : ""} &times; ${item.quantity}</td>
          <td style="padding:6px 0; text-align:right; color:#2A2A28;">${formatCurrencyINR(item.price * item.quantity)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #F5EDE0; border-radius: 12px;">
      <h2 style="color: #2E4A3B; margin-bottom: 4px;">Sehat Potli</h2>
      <p style="color: #2A2A28; font-size: 15px;">Your order <strong>${order.orderNumber}</strong> is confirmed!</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; background:#ffffff; border-radius:8px; padding: 12px;">
        ${itemsHtml}
        <tr>
          <td style="padding-top:10px; font-weight:700; color:#2E4A3B;">Total</td>
          <td style="padding-top:10px; text-align:right; font-weight:700; color:#2E4A3B;">${formatCurrencyINR(order.total)}</td>
        </tr>
      </table>
      <p style="color:#2A2A28; font-size: 13px;">
        Delivering to:<br/>
        ${order.shippingName}<br/>
        ${order.shippingAddress}, ${order.shippingCity}, ${order.shippingState} - ${order.shippingPincode}
      </p>
      <p style="color: #C89B3C; font-size: 13px; margin-top: 24px;">Team Sehat Potli — Pure. Natural. Wholesome.</p>
    </div>
  `;
}

function buildOrderPackedHtml(order) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #F5EDE0; border-radius: 12px;">
      <h2 style="color: #2E4A3B; margin-bottom: 4px;">Sehat Potli</h2>
      <p style="color: #2A2A28; font-size: 15px;">
        Good news — your order <strong>${order.orderNumber}</strong> has been packed and will be picked up for delivery soon!
      </p>
      <p style="color: #C89B3C; font-size: 13px; margin-top: 24px;">Team Sehat Potli — Pure. Natural. Wholesome.</p>
    </div>
  `;
}

function buildOrderOutForDeliveryHtml(order) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #F5EDE0; border-radius: 12px;">
      <h2 style="color: #2E4A3B; margin-bottom: 4px;">Sehat Potli</h2>
      <p style="color: #2A2A28; font-size: 15px;">
        Your order <strong>${order.orderNumber}</strong> is out for delivery — it should reach you today!
      </p>
      <p style="color: #C89B3C; font-size: 13px; margin-top: 24px;">Team Sehat Potli — Pure. Natural. Wholesome.</p>
    </div>
  `;
}

function buildOrderDeliveredHtml(order) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #F5EDE0; border-radius: 12px;">
      <h2 style="color: #2E4A3B; margin-bottom: 4px;">Sehat Potli</h2>
      <p style="color: #2A2A28; font-size: 15px;">
        Your order <strong>${order.orderNumber}</strong> has been delivered. We hope you enjoy it!
      </p>
      <p style="color: #C89B3C; font-size: 13px; margin-top: 24px;">Team Sehat Potli — Pure. Natural. Wholesome.</p>
    </div>
  `;
}

function buildOrderCancelledHtml(order) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #F5EDE0; border-radius: 12px;">
      <h2 style="color: #2E4A3B; margin-bottom: 4px;">Sehat Potli</h2>
      <p style="color: #2A2A28; font-size: 15px;">
        Your order <strong>${order.orderNumber}</strong> has been cancelled.
      </p>
      ${
        order.refundStatus === "pending" || order.refundStatus === "completed"
          ? `<p style="color: #2A2A28; font-size: 13px;">A refund of ${formatCurrencyINR(order.refundAmount)} has been initiated to your original payment method and should reflect within a few business days.</p>`
          : ""
      }
      <p style="color: #C89B3C; font-size: 13px; margin-top: 24px;">Team Sehat Potli — Pure. Natural. Wholesome.</p>
    </div>
  `;
}

const orderIncludesForEmail = [
  { model: OrderItem, include: [{ model: Product, attributes: ["id", "name"] }] },
  { model: Customer, attributes: ["id", "email"] },
];

// Sends the "Order Confirmed" email — checks/sets emailsSent.confirmed
// itself so a duplicate trigger (a retry, or Step B's webhooks later
// reusing this same function) never double-sends. Never throws: every
// failure (order not found, no email on file, Resend rejecting it) is
// logged and returned as { success: false, error }, so callers can fire
// this without their own try/catch — see orderController.createOrder and
// checkoutController.verifyPayment.
async function sendOrderConfirmedEmail(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForEmail });
  if (!order) return { success: false, error: "Order not found" };
  if (order.emailsSent?.confirmed) return { success: true, skipped: true };

  try {
    if (!order.Customer?.email) throw new Error("Order has no customer email on file");
    await sendEmail(order.Customer.email, `Order Confirmed — ${order.orderNumber}`, buildOrderConfirmedHtml(order));
    await order.update({ emailsSent: { ...(order.emailsSent || {}), confirmed: true } });
    console.log(`Email: order-confirmed sent for order ${order.orderNumber}`);
    return { success: true };
  } catch (err) {
    console.error(`Email: failed to send order-confirmed email for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Order Packed" email — the Step A placeholder for what becomes
// a real Shiprocket pickup-scan webhook event in Step B, triggered today
// right after label generation succeeds (see utils/shiprocket.js
// generateLabelAndFulfill). Same never-throws, flag-guarded contract as
// sendOrderConfirmedEmail() above.
async function sendOrderPackedEmail(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForEmail });
  if (!order) return { success: false, error: "Order not found" };
  if (order.emailsSent?.packed) return { success: true, skipped: true };

  try {
    if (!order.Customer?.email) throw new Error("Order has no customer email on file");
    await sendEmail(order.Customer.email, `Order Packed — ${order.orderNumber}`, buildOrderPackedHtml(order));
    await order.update({ emailsSent: { ...(order.emailsSent || {}), packed: true } });
    console.log(`Email: order-packed sent for order ${order.orderNumber}`);
    return { success: true };
  } catch (err) {
    console.error(`Email: failed to send order-packed email for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Out for Delivery" email — Step B, triggered from Shiprocket's
// status webhook (see utils/shiprocket.js handleShiprocketStatusWebhook).
// Same never-throws, flag-guarded contract as the senders above.
async function sendOrderOutForDeliveryEmail(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForEmail });
  if (!order) return { success: false, error: "Order not found" };
  if (order.emailsSent?.outForDelivery) return { success: true, skipped: true };

  try {
    if (!order.Customer?.email) throw new Error("Order has no customer email on file");
    await sendEmail(order.Customer.email, `Out for Delivery — ${order.orderNumber}`, buildOrderOutForDeliveryHtml(order));
    await order.update({ emailsSent: { ...(order.emailsSent || {}), outForDelivery: true } });
    console.log(`Email: out-for-delivery sent for order ${order.orderNumber}`);
    return { success: true };
  } catch (err) {
    console.error(`Email: failed to send out-for-delivery email for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Delivered" email — Step B, triggered from Shiprocket's status
// webhook. Same never-throws, flag-guarded contract as the senders above.
async function sendOrderDeliveredEmail(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForEmail });
  if (!order) return { success: false, error: "Order not found" };
  if (order.emailsSent?.delivered) return { success: true, skipped: true };

  try {
    if (!order.Customer?.email) throw new Error("Order has no customer email on file");
    await sendEmail(order.Customer.email, `Delivered — ${order.orderNumber}`, buildOrderDeliveredHtml(order));
    await order.update({ emailsSent: { ...(order.emailsSent || {}), delivered: true } });
    console.log(`Email: delivered sent for order ${order.orderNumber}`);
    return { success: true };
  } catch (err) {
    console.error(`Email: failed to send delivered email for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Order Cancelled" email — triggered from
// utils/orderCancellation.js finalizeCancellation(), after the order's
// customerStatus/refund fields are already updated (so refundStatus/
// refundAmount here reflect the real outcome, not a guess). Same
// never-throws, flag-guarded contract as the senders above.
async function sendOrderCancelledEmail(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForEmail });
  if (!order) return { success: false, error: "Order not found" };
  if (order.emailsSent?.cancelled) return { success: true, skipped: true };

  try {
    if (!order.Customer?.email) throw new Error("Order has no customer email on file");
    await sendEmail(order.Customer.email, `Order Cancelled — ${order.orderNumber}`, buildOrderCancelledHtml(order));
    await order.update({ emailsSent: { ...(order.emailsSent || {}), cancelled: true } });
    console.log(`Email: order-cancelled sent for order ${order.orderNumber}`);
    return { success: true };
  } catch (err) {
    console.error(`Email: failed to send order-cancelled email for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendEmail,
  sendOrderConfirmedEmail,
  sendOrderPackedEmail,
  sendOrderOutForDeliveryEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
};
