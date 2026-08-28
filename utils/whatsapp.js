const { IntegrationSetting } = require("../models");
const { decrypt } = require("./encryption");

// Meta Cloud API (WhatsApp Business) credentials — same DB-first pattern as
// Shiprocket/Razorpay (see utils/shiprocket.js, utils/razorpay.js): stored in
// IntegrationSettings under integrationKey "whatsapp", admin-managed from
// Settings > Integrations > WhatsApp (see adminIntegrationSettingsController.js,
// which already handles the generic get/update — this file only reads).
//
// Shape stored in IntegrationSettings.config:
//   { accessToken(encrypted), phoneNumberId, businessAccountId, webhookVerifyToken(encrypted) }
//
// Message-sending (using accessToken/phoneNumberId to call the Graph API) is
// intentionally not implemented here yet — this task is only the webhook
// endpoint + credential storage; see controllers/webhookController.js
// whatsappVerifyWebhook/whatsappWebhook for where these are consumed so far.
const INTEGRATION_KEY = "whatsapp";

async function getConfig() {
  const setting = await IntegrationSetting.findOne({ where: { integrationKey: INTEGRATION_KEY } });
  return setting?.config || {};
}

// No .env fallback, same reasoning as Shiprocket's getWebhookSecret — this is
// a brand-new integration with nothing to migrate from, so an unconfigured
// webhook should fail closed rather than silently accept anything.
async function getWebhookVerifyToken() {
  const config = await getConfig();
  if (!config.webhookVerifyToken) {
    throw new Error(
      "WhatsApp webhook verify token is not configured — set it up from the admin panel (Settings > Integrations > WhatsApp)",
    );
  }
  return decrypt(config.webhookVerifyToken);
}

// Not yet consumed anywhere (message-sending is out of scope for this task)
// but exported now so that work doesn't need to re-derive the credential
// shape later.
async function getCredentials() {
  const config = await getConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error(
      "WhatsApp credentials are not configured — set them up from the admin panel (Settings > Integrations > WhatsApp)",
    );
  }
  return {
    accessToken: decrypt(config.accessToken),
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId || null,
  };
}

module.exports = { getWebhookVerifyToken, getCredentials };
