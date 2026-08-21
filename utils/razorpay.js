const crypto = require("crypto");
const { IntegrationSetting } = require("../models");
const { encrypt, decrypt } = require("./encryption");

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";
const INTEGRATION_KEY = "razorpay";
const VALID_MODES = ["test", "live"];

// ---------------------------------------------------------------------------
// Config storage — test/live credential sets + which one is active.
// ---------------------------------------------------------------------------
//
// Shape stored in IntegrationSettings.config (integrationKey: "razorpay"):
//   { activeMode: "test" | "live",
//     test: { keyId, keySecret(encrypted), webhookSecret(encrypted) },
//     live: { keyId, keySecret(encrypted), webhookSecret(encrypted) } }
//
// Older rows predate test/live and are flat: { keyId, keySecret, webhookSecret }
// (no activeMode key) — getRazorpayConfig() migrates that into `live` the
// first time it's read, since those are real credentials already configured
// in production and must keep working without anyone re-entering them.

async function saveRazorpayConfig(config) {
  let setting = await IntegrationSetting.findOne({
    where: { integrationKey: INTEGRATION_KEY },
  });
  if (setting) {
    setting.config = config;
    await setting.save();
  } else {
    setting = await IntegrationSetting.create({
      integrationKey: INTEGRATION_KEY,
      config,
    });
  }
  return setting;
}

// Always returns the normalized { activeMode, test, live } shape — migrating
// and persisting the old flat shape on first read if that's what's stored.
async function getRazorpayConfig() {
  const setting = await IntegrationSetting.findOne({
    where: { integrationKey: INTEGRATION_KEY },
  });
  const config = setting?.config || {};

  if (!config.activeMode) {
    const migrated = {
      activeMode: "live",
      live: {
        keyId: config.keyId || "",
        keySecret: config.keySecret || "",
        webhookSecret: config.webhookSecret || "",
      },
      test: {},
    };
    await saveRazorpayConfig(migrated);
    if (migrated.live.keyId) {
      console.log(
        "Razorpay config migrated to test/live shape — existing credentials moved to 'live'",
      );
    }
    return migrated;
  }

  return {
    activeMode: config.activeMode,
    test: config.test || {},
    live: config.live || {},
  };
}

// Partial update of one mode's credentials — blank/omitted keySecret or
// webhookSecret keeps the existing stored (encrypted) value, same "leave
// blank to keep current" behavior as the old single-set form.
async function updateRazorpayModeCredentials(mode, patch = {}) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`mode must be one of: ${VALID_MODES.join(", ")}`);
  }

  const current = await getRazorpayConfig();
  const currentModeConfig = current[mode] || {};

  const nextModeConfig = { ...currentModeConfig };
  if (patch.keyId !== undefined) nextModeConfig.keyId = patch.keyId;
  if (patch.keySecret) nextModeConfig.keySecret = encrypt(patch.keySecret);
  if (patch.webhookSecret)
    nextModeConfig.webhookSecret = encrypt(patch.webhookSecret);

  const nextConfig = { ...current, [mode]: nextModeConfig };
  await saveRazorpayConfig(nextConfig);
  return nextConfig;
}

// Switches which mode's credentials are actually used — never touches
// either mode's stored credential values.
async function setRazorpayActiveMode(activeMode) {
  if (!VALID_MODES.includes(activeMode)) {
    throw new Error(`activeMode must be one of: ${VALID_MODES.join(", ")}`);
  }
  const current = await getRazorpayConfig();
  const nextConfig = { ...current, activeMode };
  await saveRazorpayConfig(nextConfig);
  return nextConfig;
}

// ---------------------------------------------------------------------------
// Credentials for whichever mode is active — this is the only thing that
// changed for callers below (createRazorpayOrder, signature verification,
// the webhook): they always just get "the currently active mode's keys"
// and don't know or care whether that's test or live.
// ---------------------------------------------------------------------------

async function getRazorpayCredentials() {
  const { activeMode, test, live } = await getRazorpayConfig();
  const modeConfig = activeMode === "test" ? test : live;
  if (!modeConfig?.keyId || !modeConfig?.keySecret) {
    throw new Error(
      `Razorpay (${activeMode} mode) is not configured — set it up from the admin panel (Integrations > Razorpay)`,
    );
  }
  return { keyId: modeConfig.keyId, keySecret: decrypt(modeConfig.keySecret) };
}

// The webhook secret is set independently in Razorpay's dashboard (separate
// from the API key/secret pair) — stored per-mode in the same row. Falls
// back to RAZORPAY_WEBHOOK_SECRET from .env only when the active mode has no
// webhook secret set yet, and in that case persists it into the DB as a
// one-time seed — every call after that reads the DB. Same DB-first,
// env-fallback-then-seed pattern as Shiprocket's getCredentials() in
// utils/shiprocket.js.
async function getRazorpayWebhookSecret() {
  const current = await getRazorpayConfig();
  const { activeMode } = current;
  const modeConfig = current[activeMode] || {};

  if (modeConfig.webhookSecret) {
    return decrypt(modeConfig.webhookSecret);
  }

  const envSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!envSecret) {
    throw new Error(
      `Razorpay (${activeMode} mode) webhook secret is not configured — set it up from the admin panel (Integrations > Razorpay), or set RAZORPAY_WEBHOOK_SECRET in .env for first-time setup`,
    );
  }

  const nextConfig = {
    ...current,
    [activeMode]: { ...modeConfig, webhookSecret: encrypt(envSecret) },
  };
  await saveRazorpayConfig(nextConfig);
  console.log(
    `Razorpay (${activeMode} mode) webhook secret seeded into IntegrationSettings from .env`,
  );

  return envSecret;
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

// amount is in rupees, same convention as createRazorpayOrder above —
// converted to paise here. Used by utils/orderCancellation.js for a
// prepaid+paid order's cancellation refund. Razorpay's response `status` is
// "processed" for an instant refund or "pending" if it needs manual
// processing on their end — the caller maps that onto Order.refundStatus,
// this just returns Razorpay's raw response.
async function createRefund({ paymentId, amount, notes }) {
  return razorpayRequest(`/payments/${paymentId}/refund`, {
    method: "POST",
    body: JSON.stringify({
      amount: Math.round(Number(amount) * 100),
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
function verifyPaymentSignature({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  keySecret,
}) {
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return timingSafeStringEqual(expected, razorpaySignature);
}

// Verifies a Razorpay webhook request — HMAC-SHA256 of the *raw* request
// body using the separately-configured webhook secret.
function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return timingSafeStringEqual(expected, signature);
}

module.exports = {
  getRazorpayConfig,
  updateRazorpayModeCredentials,
  setRazorpayActiveMode,
  getRazorpayCredentials,
  getRazorpayWebhookSecret,
  createRazorpayOrder,
  createRefund,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
