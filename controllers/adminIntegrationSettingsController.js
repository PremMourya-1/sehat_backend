const { IntegrationSetting } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { encrypt } = require("../utils/encryption");
const shiprocket = require("../utils/shiprocket");

// Which config fields must be stored encrypted, per integration. Adding a
// new integration is just a new entry here — no new table, no new controller.
const SENSITIVE_FIELDS = {
  shiprocket: ["password"],
  razorpay: ["keySecret", "webhookSecret"],
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
