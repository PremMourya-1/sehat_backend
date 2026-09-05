const { IntegrationSetting } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { encrypt } = require("../utils/encryption");
const shiprocket = require("../utils/shiprocket");
const whatsapp = require("../utils/whatsapp");

// Events sendTestWhatsappTemplate below will accept — same 4 order-status
// events utils/whatsapp.js's TEST_PARAMS_BY_EVENT has dummy data for.
const TESTABLE_WHATSAPP_EVENTS = ["orderConfirmed", "orderDispatched", "orderOutForDelivery", "orderDelivered"];

// Which config fields must be stored encrypted, per integration. Adding a
// new integration is just a new entry here — no new table, no new controller
// — as long as its config is a flat object like this one. Razorpay outgrew
// this shape (test/live credential sets + an active-mode switch) and has
// its own dedicated controller/routes now — see
// adminRazorpaySettingsController.js and routes/adminRoutes.js.
const SENSITIVE_FIELDS = {
  shiprocket: ["password", "webhookSecret"],
  resend: ["apiKey"],
  whatsapp: ["accessToken", "webhookVerifyToken"],
};

// Called right after an integration's settings are saved, so anything
// already cached under the old credentials (e.g. Shiprocket's in-memory
// token) doesn't keep being used until it naturally expires.
const ON_SETTINGS_UPDATED = {
  shiprocket: () => shiprocket.invalidateToken(),
};

// Strips sensitive fields out of a config before it ever leaves the server,
// replacing each with a `has<Field>` boolean so the admin UI can show
// "already configured" without the secret itself being sent back down.
function toPublicConfig(key, config = {}) {
  const sensitiveFields = SENSITIVE_FIELDS[key] || [];
  const publicConfig = { ...config };
  for (const field of sensitiveFields) {
    const flagName = `has${field[0].toUpperCase()}${field.slice(1)}`;
    publicConfig[flagName] = Boolean(publicConfig[field]);
    delete publicConfig[field];
  }
  return publicConfig;
}

// GET /api/admin/integrations/:key
exports.getIntegrationSettings = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const setting = await IntegrationSetting.findOne({ where: { integrationKey: key } });

  if (!setting) {
    return sendSuccess(res, { integrationKey: key, config: toPublicConfig(key), updatedAt: null });
  }

  return sendSuccess(res, {
    integrationKey: setting.integrationKey,
    config: toPublicConfig(key, setting.config),
    updatedAt: setting.updatedAt,
  });
});

// PUT /api/admin/integrations/:key  { config: {...} }
// Sensitive fields left blank/omitted keep their existing stored value —
// the client never gets the real secret back, so it can't resubmit it.
exports.updateIntegrationSettings = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { config } = req.body;
  if (!config || typeof config !== "object") {
    return sendError(res, "config is required", 400);
  }

  const sensitiveFields = SENSITIVE_FIELDS[key] || [];
  let setting = await IntegrationSetting.findOne({ where: { integrationKey: key } });

  const nextConfig = { ...(setting?.config || {}), ...config };
  for (const field of sensitiveFields) {
    nextConfig[field] = config[field] ? encrypt(config[field]) : setting?.config?.[field] || "";
  }

  if (setting) {
    setting.config = nextConfig;
    await setting.save();
  } else {
    setting = await IntegrationSetting.create({ integrationKey: key, config: nextConfig });
  }

  ON_SETTINGS_UPDATED[key]?.();

  return sendSuccess(
    res,
    {
      integrationKey: setting.integrationKey,
      config: toPublicConfig(key, setting.config),
      updatedAt: setting.updatedAt,
    },
    "Settings updated successfully",
  );
});

// POST /api/admin/integrations/whatsapp/test-send  { phoneNumber, event }
// Sends one of the 4 order-status templates, with dummy placeholder data,
// straight to an arbitrary number — lets an admin confirm a template is
// really APPROVED and really deliverable (credentials, phone number ID,
// send permission) on demand, without needing a real order to walk through
// every status first. See utils/whatsapp.js sendTestWhatsappMessage — unlike
// every other WhatsApp sender in this codebase, that one THROWS on failure
// on purpose, so the real Meta error reaches the admin here instead of only
// ever being logged server-side.
exports.sendTestWhatsappTemplate = asyncHandler(async (req, res) => {
  const { phoneNumber, event } = req.body;
  if (!phoneNumber) return sendError(res, "phoneNumber is required", 400);
  if (!TESTABLE_WHATSAPP_EVENTS.includes(event)) {
    return sendError(res, `event must be one of: ${TESTABLE_WHATSAPP_EVENTS.join(", ")}`, 400);
  }

  // Resolved BEFORE the send attempt and echoed back in both the success and
  // failure message — added after a real back-and-forth debugging a 132001
  // ("template doesn't exist in the translation") error where there was no
  // way to tell, from the response alone, whether the name/language actually
  // saved in Settings > Integrations > WhatsApp were the ones really used,
  // or whether Render just hadn't redeployed that config-read code yet. Now
  // the answer is always right there in the message, no more guessing.
  const templateName = await whatsapp.getTemplateName(event);
  const languageCode = await whatsapp.getTemplateLanguage();
  const usedLabel = `template "${templateName}" (language "${languageCode}")`;

  try {
    await whatsapp.sendTestWhatsappMessage(phoneNumber, event);
    return sendSuccess(
      res,
      { templateName, languageCode },
      `Test message sent using ${usedLabel} — check the WhatsApp number for delivery.`,
    );
  } catch (err) {
    return sendError(res, `${err.message || "Test message failed to send"} — sent as ${usedLabel}`, 400);
  }
});
