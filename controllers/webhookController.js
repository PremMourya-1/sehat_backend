const { Order } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { getRazorpayWebhookSecret, verifyWebhookSignature } = require("../utils/razorpay");
const { markOrderPaid } = require("../utils/markOrderPaid");
const { emitNewOrder } = require("../utils/socket");

// POST /api/webhooks/razorpay — fallback for when the frontend's
// verify-payment callback never fires (browser closed mid-payment, network
// drop right after Razorpay's modal completes). Razorpay calls this
// server-to-server, so it's public/no customerAuth — the webhook signature
// is what authenticates the request instead. See index.js's express.json()
// `verify` callback for where req.rawBody comes from; this is the only
// place in the app that needs the exact raw bytes rather than parsed JSON.
exports.razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  if (!signature) {
    return sendError(res, "Missing signature", 400);
  }

  let webhookSecret;
  try {
    webhookSecret = await getRazorpayWebhookSecret();
  } catch (err) {
    console.error(`Razorpay webhook: ${err.message}`);
    return sendError(res, "Webhook not configured", 500);
  }

  const isValid = verifyWebhookSignature({ rawBody: req.rawBody, signature, webhookSecret });
  if (!isValid) {
    console.error("Razorpay webhook: signature mismatch — possible spoofed request, ignoring");
    return sendError(res, "Invalid signature", 400);
  }

  const event = req.body;
  if (event.event === "payment.captured") {
    const payment = event.payload?.payment?.entity;
    const razorpayOrderId = payment?.order_id;
    const razorpayPaymentId = payment?.id;

    const order = razorpayOrderId ? await Order.findOne({ where: { razorpayOrderId } }) : null;
    if (order) {
      const result = await markOrderPaid(order.id, razorpayPaymentId);
      console.log(
        result.alreadyPaid
          ? `Razorpay webhook: order ${order.orderNumber} was already paid (likely confirmed via the frontend callback first)`
          : `Razorpay webhook: order ${order.orderNumber} marked paid via webhook fallback`,
      );
      if (!result.alreadyPaid) {
        emitNewOrder(order).catch((err) => console.error(`Failed to emit new-order notification: ${err.message}`));
      }
    } else {
      console.error(`Razorpay webhook: payment.captured for unknown razorpay order ${razorpayOrderId}`);
    }
  }

  // Always 200 — Razorpay retries on non-2xx, and an order that can't be
  // found now never will be, so there's nothing a retry would fix.
  return sendSuccess(res, null, "Webhook processed");
});
