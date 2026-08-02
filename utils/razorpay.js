const crypto = require("crypto");
const { IntegrationSetting } = require("../models");
const { decrypt } = require("./encryption");

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";
const INTEGRATION_KEY = "razorpay";

// Reads Razorpay credentials from IntegrationSettings — same DB-driven,
// admin-panel-managed pattern as Shiprocket's getCredentials() (see
// utils/shiprocket.js). keyId is plain; keySecret is encrypted at rest and
// decrypted here for use against Razorpay's API.
async function getRazorpayCredentials() {
  const setting = await IntegrationSetting.findOne({ where: { integrationKey: INTEGRATION_KEY } });
  if (!setting?.config?.keyId || !setting?.config?.keySecret) {
    throw new Error("Razorpay is not configured — set it up from the admin panel (Integrations > Razorpay)");
  }
  return {
    keyId: setting.config.keyId,
    keySecret: decrypt(setting.config.keySecret),
  };
}

// The webhook secret is set independently in Razorpay's dashboard (separate
// from the API key/secret pair) — stored in the same IntegrationSetting row.
async function getRazorpayWebhookSecret() {
  const setting = await IntegrationSetting.findOne({ where: { integrationKey: INTEGRATION_KEY } });
  if (!setting?.config?.webhookSecret) {
    throw new Error("Razorpay webhook secret is not configured — set it up from the admin panel (Integrations > Razorpay)");
  }
  return decrypt(setting.config.webhookSecret);
}

async function razorpayRequest(path, options = {}) {
  const { keyId, keySecret } = await getRazorpayCredentials();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Razorpay request failed (${res.status}) ${path}: ${text}`);
    throw new Error(`Razorpay request failed (${res.status})`);
  }

  return res.json();
}

// amount is in rupees — Razorpay's API wants paise (smallest currency unit).
async function createRazorpayOrder({ amount, receipt, notes }) {
  return razorpayRequest("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      receipt,
      notes,
    }),
  });
}

// Timing-safe HMAC comparison — same approach as middleware/internalAuth.js's
// shared-secret check, just with crypto.createHmac output instead of a
// static secret.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Verifies the signature Razorpay's checkout.js callback hands back to the
// frontend after a payment completes — HMAC-SHA256 of
// "razorpay_order_id|razorpay_payment_id" using the account's key secret.
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret }) {
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return timingSafeStringEqual(expected, razorpaySignature);
}

// Verifies a Razorpay webhook request — HMAC-SHA256 of the *raw* request
// body using the separately-configured webhook secret.
function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return timingSafeStringEqual(expected, signature);
}

module.exports = {
  getRazorpayCredentials,
  getRazorpayWebhookSecret,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
