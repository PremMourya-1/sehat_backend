const { ShiprocketWebhookLog } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { getRazorpayWebhookSecret, verifyWebhookSignature } = require("../utils/razorpay");
const { getWebhookSecret: getShiprocketWebhookSecret, handleShiprocketStatusWebhook } = require("../utils/shiprocket");
const { convertAbandonedCheckout } = require("../utils/convertAbandonedCheckout");
const { emitNewOrder } = require("../utils/socket");
const { sendOrderConfirmedEmail } = require("../utils/email");

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

    if (razorpayOrderId) {
      // No customerId guard here — a valid webhook signature (checked
      // above) is itself the authentication for this path, there's no
      // logged-in customer to scope it to.
      const result = await convertAbandonedCheckout(razorpayOrderId, razorpayPaymentId);
      if (result.success) {
        console.log(
          result.alreadyConverted
            ? `Razorpay webhook: order ${result.order.orderNumber} was already converted (likely confirmed via the frontend callback first)`
            : `Razorpay webhook: order ${result.order.orderNumber} created via webhook fallback`,
        );
        if (!result.alreadyConverted) {
          emitNewOrder(result.order).catch((err) => console.error(`Failed to emit new-order notification: ${err.message}`));
          sendOrderConfirmedEmail(result.order.id).catch((err) =>
            console.error(`Email: order-confirmed send threw unexpectedly for order ${result.order.orderNumber}: ${err.message}`),
          );
        }
      } else {
        console.error(`Razorpay webhook: conversion failed for razorpay order ${razorpayOrderId} — ${result.reason}`);
      }
    } else {
      console.error("Razorpay webhook: payment.captured event missing order_id");
    }
  }

  // Always 200 — Razorpay retries on non-2xx, and an order that can't be
  // found now never will be, so there's nothing a retry would fix.
  return sendSuccess(res, null, "Webhook processed");
});

// Shiprocket's dashboard (Settings > API > Configure Webhook) sends back
// whatever "Webhook Secret" is configured there — exactly which header
// carries it isn't nailed down in Shiprocket's published docs at the time
// this was written (see shiprocket-configuration.md for the full note), so
// this checks the most commonly documented convention (x-api-key) and also
// accepts it as a ?token= query param on the registered URL, which is
// entirely within our own control regardless of what Shiprocket does.
const SHIPROCKET_WEBHOOK_HEADER = "x-api-key";

// POST /api/webhooks/courier-updates — public, no admin auth; Shiprocket calls
// this directly (see utils/shiprocket.js getWebhookSecret/
// handleShiprocketStatusWebhook, and models/ShiprocketWebhookLog.js for the
// raw audit trail). Every verified request is logged before processing, so
// a status that doesn't update as expected can be debugged from the DB.
exports.shiprocketWebhook = asyncHandler(async (req, res) => {
  let expectedSecret;
  try {
    expectedSecret = await getShiprocketWebhookSecret();
  } catch (err) {
    console.error(`Shiprocket webhook: ${err.message}`);
    return sendError(res, "Webhook not configured", 500);
  }

  const providedSecret = req.headers[SHIPROCKET_WEBHOOK_HEADER] || req.query.token;
  if (!providedSecret || providedSecret !== expectedSecret) {
    console.error("Shiprocket webhook: secret mismatch — possible spoofed request, ignoring");
    return sendError(res, "Invalid webhook secret", 401);
  }

  const payload = req.body || {};
  const result = await handleShiprocketStatusWebhook(payload);

  await ShiprocketWebhookLog.create({
    orderId: result.orderId || null,
    eventType: String(payload?.current_status ?? payload?.shipment_status ?? ""),
    rawPayload: payload,
    source: "webhook",
  });

  if (!result.success) {
    console.error(`Shiprocket webhook: processing failed — ${result.error}`);
  }

  // Always 200 once verified — same reasoning as the Razorpay webhook
  // above: Shiprocket retries on non-2xx, and a payload we can't match to
  // an order now never will be, so nothing a retry would fix. The raw
  // payload is logged either way for follow-up.
  return sendSuccess(res, null, "Webhook processed");
});
