const { IntegrationSetting, Order, Customer } = require("../models");
const { decrypt } = require("./encryption");

// Meta Cloud API (WhatsApp Business) credentials — same DB-first pattern as
// Shiprocket/Razorpay (see utils/shiprocket.js, utils/razorpay.js): stored in
// IntegrationSettings under integrationKey "whatsapp", admin-managed from
// Settings > Integrations > WhatsApp (see adminIntegrationSettingsController.js,
// which already handles the generic get/update).
//
// Shape stored in IntegrationSettings.config:
//   { accessToken(encrypted), phoneNumberId, businessAccountId,
//     webhookVerifyToken(encrypted),
//     templates: { orderConfirmed, orderDispatched, orderOutForDelivery,
//                   orderDelivered } }
// `templates` holds the ACTIVE Meta-approved template name per event —
// plain text (not a secret), admin-editable from Settings > Integrations >
// WhatsApp so switching to a different already-approved template variant
// (e.g. after a resubmission, or to A/B two approved variants) is a
// Settings-page edit, never a deploy. See getTemplateName() below.
//
// Below: sendTemplateMessage (the one Graph API call every message goes
// through — same shared-entry-point role as utils/email.js's sendEmail),
// order-status wrappers (sendOrderConfirmedWhatsApp/
// sendOrderDispatchedWhatsApp/sendOrderOutForDeliveryWhatsApp/
// sendOrderDeliveredWhatsApp — see whatsappSent on models/Order.js for the
// send-once guard, and the trigger points alongside utils/email.js's
// equivalents in controllers/orderController.js, checkoutController.js,
// webhookController.js, and utils/shiprocket.js), and sendOtpWhatsApp (used
// by utils/otpProviders/whatsapp.js as the "whatsapp" OTP_PROVIDER option).
const INTEGRATION_KEY = "whatsapp";
const GRAPH_API_VERSION = "v21.0";

// Default/fallback template names for the 4 order-status events — used only
// when the admin hasn't (yet) overridden a name in Settings > Integrations >
// WhatsApp (see getTemplateName() below, and IntegrationSettings.config.
// templates). Admin-configurable specifically so that if Meta ever requires
// a resubmission under a new name (as already happened once here — hence
// "_v2"), or multiple approved variants exist for the same event, switching
// which one is active is a Settings-page edit, not a deploy. Keep these in
// sync with WhatsAppSettings.jsx's own copy of the same defaults (used there
// purely for pre-filling the form before anything's been explicitly saved).
const DEFAULT_TEMPLATE_NAMES = {
  orderConfirmed: "order_confirmed_v2",
  orderDispatched: "order_dispatched_v2",
  orderOutForDelivery: "order_out_for_delivery_v2",
  orderDelivered: "order_delivered",
};

// Not admin-configurable (unlike DEFAULT_TEMPLATE_NAMES above) — Meta's
// Authentication category templates are managed separately in WhatsApp
// Manager from the Utility ones, and this task didn't ask for OTP's
// template name to be exposed on the Settings page.
const TEMPLATES = {
  otp: "otp_verification",
};
const TEMPLATE_LANGUAGE = "en_US";

// Reads the active template name for one of the 4 order-status events —
// config.templates.<event> if the admin has set one, else
// DEFAULT_TEMPLATE_NAMES[event]. Never throws (an unset/malformed config
// just falls back), matching the task's "avoid a hard crash" requirement.
async function getTemplateName(event) {
  const config = await getConfig();
  return config.templates?.[event] || DEFAULT_TEMPLATE_NAMES[event];
}

// Reads the active language code for the 4 order-status templates —
// config.templateLanguage if the admin has set one, else TEMPLATE_LANGUAGE
// ("en_US"). Admin-configurable for the same reason getTemplateName() is:
// Meta's send call fails with error 132001 ("Template name does not exist
// in the translation") if the language code here doesn't exactly match how
// the template was approved in WhatsApp Manager — and templates submitted
// by hand through the Manager UI (as these were) commonly end up approved
// under plain "English" (en) rather than "English (US)" (en_US) unless
// that's deliberately picked. Making this a Settings-page edit instead of a
// hardcoded constant means fixing a language mismatch never needs a
// redeploy. Not used for the OTP/Authentication template — see TEMPLATES.otp
// above, that one stays on TEMPLATE_LANGUAGE like its name is unconfigurable.
async function getTemplateLanguage() {
  const config = await getConfig();
  return config.templateLanguage || TEMPLATE_LANGUAGE;
}

// The exact drafts to submit for Meta review (WhatsApp Manager > Account
// Tools > Message Templates, or via submitAllTemplates()/scripts/
// submitWhatsappTemplates.js below) — kept here so the submitted wording
// and the constants/component shapes the senders above assume stay in
// one place. See memory/whatsapp_integration_architecture.md for
// submission/approval status.
const TEMPLATE_DRAFTS = [
  {
    name: DEFAULT_TEMPLATE_NAMES.orderConfirmed,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your Sehat Potli order #{{2}} has been confirmed! Total: ₹{{3}}. We'll notify you once it's on its way. Thank you for shopping with us! 🌰",
        example: { body_text: [["Priya", "ORD-1234567890", "1,280"]] },
      },
    ],
  },
  {
    name: DEFAULT_TEMPLATE_NAMES.orderDispatched,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Good news {{1}}! Your order #{{2}} has been dispatched via {{3}} and is on its way. Estimated delivery: {{4}}. Track here: {{5}}",
        example: {
          body_text: [["Priya", "ORD-1234567890", "Delhivery", "31 Aug 2026", "https://sehatpotli.in/account/orders/abc123"]],
        },
      },
    ],
  },
  {
    name: DEFAULT_TEMPLATE_NAMES.orderOutForDelivery,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your order #{{2}} is out for delivery and should reach you today! 📦",
        example: { body_text: [["Priya", "ORD-1234567890"]] },
      },
    ],
  },
  {
    name: DEFAULT_TEMPLATE_NAMES.orderDelivered,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your order #{{2}} has been delivered! We hope you enjoy your Sehat Potli goodies. If you loved it, we'd appreciate a review! 🌟",
        example: { body_text: [["Priya", "ORD-1234567890"]] },
      },
    ],
  },
  {
    // Meta's built-in Authentication category — wording is generated by
    // Meta itself (not free text like the Utility templates above), per
    // their one-time-passcode format. add_security_recommendation appends
    // their standard "don't share this code" line; code_expiration_minutes
    // matches OTP_TTL_MS in controllers/mobileVerificationController.js (10
    // minutes); the OTP button gives the customer a one-tap "copy code"
    // action, matching sendOtpWhatsApp()'s component shape above.
    name: TEMPLATES.otp,
    category: "AUTHENTICATION",
    components: [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 10 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
    ],
  },
];

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

// Meta's Cloud API wants the recipient as a plain country-code-prefixed
// number, no "+", no spaces (e.g. "919876543210") — same convention
// utils/otpProviders/msg91.js already uses for SMS. Every phone number in
// this codebase (Customer.mobileNumber, Order.shippingPhone) is stored as a
// bare 10-digit Indian number, so "91" is hardcoded here rather than made
// configurable — same assumption the rest of the checkout flow already
// makes (PINCODE_REGEX, mobile validation, etc. are all India-only).
function toWhatsappPhone(mobileNumber) {
  const digits = String(mobileNumber || "").replace(/\D/g, "");
  if (digits.length !== 10) {
    throw new Error(`Invalid mobile number for WhatsApp send: "${mobileNumber}"`);
  }
  return `91${digits}`;
}

// The one function every WhatsApp send goes through — POSTs to Meta's
// Cloud API (POST /{phone-number-id}/messages), same shared-entry-point
// role as utils/email.js's sendEmail(). Throws on failure (mirrors
// sendEmail, not the OTP providers) — callers that shouldn't let a WhatsApp
// error interrupt their own flow are expected to catch it themselves, same
// convention as sendOrderConfirmedEmail() etc. below already follow.
async function sendTemplateMessage(toPhoneNumber, templateName, languageCode, components) {
  const { accessToken, phoneNumberId } = await getCredentials();
  const to = toWhatsappPhone(toPhoneNumber);

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode || TEMPLATE_LANGUAGE },
        components,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Meta's error shape: { error: { message, type, code, error_subcode, fbtrace_id } }
    throw new Error(data?.error?.message || `WhatsApp send failed (${res.status})`);
  }
  return data;
}

function formatCurrencyINR(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatDateShort(date) {
  if (!date) return "soon";
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const orderIncludesForWhatsapp = [{ model: Customer, attributes: ["id", "name"] }];

// Sends the "Order Confirmed" WhatsApp template — checks/sets
// whatsappSent.confirmed itself so a duplicate trigger never double-sends,
// same contract as sendOrderConfirmedEmail() in utils/email.js. Never
// throws: every failure is logged and returned as { success, error } so
// callers can fire this without their own try/catch. Which template NAME
// is used is admin-configurable (see getTemplateName()) — this function's
// own variable-building below never changes regardless of which approved
// name is active for the event.
async function sendOrderConfirmedWhatsApp(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForWhatsapp });
  if (!order) return { success: false, error: "Order not found" };
  if (order.whatsappSent?.confirmed) return { success: true, skipped: true };

  try {
    if (!order.shippingPhone) throw new Error("Order has no shipping phone on file");
    const templateName = await getTemplateName("orderConfirmed");
    const languageCode = await getTemplateLanguage();
    await sendTemplateMessage(order.shippingPhone, templateName, languageCode, [
      {
        type: "body",
        parameters: [
          { type: "text", text: order.Customer?.name || order.shippingName || "there" },
          { type: "text", text: order.orderNumber },
          { type: "text", text: formatCurrencyINR(order.total).replace("₹", "") },
        ],
      },
    ]);
    await order.update({ whatsappSent: { ...(order.whatsappSent || {}), confirmed: true } });
    console.log(`WhatsApp: order-confirmed sent for order ${order.orderNumber} (template "${templateName}")`);
    return { success: true };
  } catch (err) {
    console.error(`WhatsApp: failed to send order-confirmed message for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Order Dispatched" WhatsApp template — fires at the same
// trigger point as sendOrderPackedEmail (label generation, or the
// pickup-scan webhook — see utils/shiprocket.js), once courierName/
// estimatedDeliveryDate are set on the order. Same never-throws,
// flag-guarded, admin-configurable-template-name contract as above.
async function sendOrderDispatchedWhatsApp(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForWhatsapp });
  if (!order) return { success: false, error: "Order not found" };
  if (order.whatsappSent?.dispatched) return { success: true, skipped: true };

  try {
    if (!order.shippingPhone) throw new Error("Order has no shipping phone on file");
    const trackingUrl = `${process.env.STORE_FRONT_URL || "https://sehatpotli.in"}/account/orders/${order.id}`;
    const templateName = await getTemplateName("orderDispatched");
    const languageCode = await getTemplateLanguage();
    await sendTemplateMessage(order.shippingPhone, templateName, languageCode, [
      {
        type: "body",
        parameters: [
          { type: "text", text: order.Customer?.name || order.shippingName || "there" },
          { type: "text", text: order.orderNumber },
          { type: "text", text: order.courierName || "our courier partner" },
          { type: "text", text: formatDateShort(order.estimatedDeliveryDate) },
          { type: "text", text: trackingUrl },
        ],
      },
    ]);
    await order.update({ whatsappSent: { ...(order.whatsappSent || {}), dispatched: true } });
    console.log(`WhatsApp: order-dispatched sent for order ${order.orderNumber} (template "${templateName}")`);
    return { success: true };
  } catch (err) {
    console.error(`WhatsApp: failed to send order-dispatched message for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Out for Delivery" WhatsApp template — fires at the same
// trigger point as sendOrderOutForDeliveryEmail (Shiprocket status
// webhook). New as of this task — out-for-delivery previously had no
// WhatsApp counterpart at all (see utils/notifications.js). Same
// never-throws, flag-guarded, admin-configurable-template-name contract as
// the other three senders.
async function sendOrderOutForDeliveryWhatsApp(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForWhatsapp });
  if (!order) return { success: false, error: "Order not found" };
  if (order.whatsappSent?.outForDelivery) return { success: true, skipped: true };

  try {
    if (!order.shippingPhone) throw new Error("Order has no shipping phone on file");
    const templateName = await getTemplateName("orderOutForDelivery");
    const languageCode = await getTemplateLanguage();
    await sendTemplateMessage(order.shippingPhone, templateName, languageCode, [
      {
        type: "body",
        parameters: [
          { type: "text", text: order.Customer?.name || order.shippingName || "there" },
          { type: "text", text: order.orderNumber },
        ],
      },
    ]);
    await order.update({ whatsappSent: { ...(order.whatsappSent || {}), outForDelivery: true } });
    console.log(`WhatsApp: out-for-delivery sent for order ${order.orderNumber} (template "${templateName}")`);
    return { success: true };
  } catch (err) {
    console.error(`WhatsApp: failed to send out-for-delivery message for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Sends the "Order Delivered" WhatsApp template — fires at the same
// trigger point as sendOrderDeliveredEmail (Shiprocket status webhook).
// Same never-throws, flag-guarded, admin-configurable-template-name
// contract as above.
async function sendOrderDeliveredWhatsApp(orderId) {
  const order = await Order.findByPk(orderId, { include: orderIncludesForWhatsapp });
  if (!order) return { success: false, error: "Order not found" };
  if (order.whatsappSent?.delivered) return { success: true, skipped: true };

  try {
    if (!order.shippingPhone) throw new Error("Order has no shipping phone on file");
    const templateName = await getTemplateName("orderDelivered");
    const languageCode = await getTemplateLanguage();
    await sendTemplateMessage(order.shippingPhone, templateName, languageCode, [
      {
        type: "body",
        parameters: [
          { type: "text", text: order.Customer?.name || order.shippingName || "there" },
          { type: "text", text: order.orderNumber },
        ],
      },
    ]);
    await order.update({ whatsappSent: { ...(order.whatsappSent || {}), delivered: true } });
    console.log(`WhatsApp: order-delivered sent for order ${order.orderNumber} (template "${templateName}")`);
    return { success: true };
  } catch (err) {
    console.error(`WhatsApp: failed to send order-delivered message for order ${order.orderNumber}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Dummy body parameters for each of the 4 order-status events — same
// shape/order as the real senders above (sendOrderConfirmedWhatsApp etc.)
// build for a real order, just with placeholder values instead of a real
// Customer/Order record. Used only by sendTestWhatsappMessage() below, so
// an admin can confirm a template is actually APPROVED and actually
// deliverable (right credentials, right permissions) against their own
// phone, without needing a real order to walk through every status.
const TEST_PARAMS_BY_EVENT = {
  orderConfirmed: ["Test Customer", "TEST-0001", "999"],
  orderDispatched: ["Test Customer", "TEST-0001", "Test Courier", "1 Jan 2030", "https://sehatpotli.in/account/orders/test"],
  orderOutForDelivery: ["Test Customer", "TEST-0001"],
  orderDelivered: ["Test Customer", "TEST-0001"],
};

// Sends one of the 4 order-status templates to an arbitrary phone number
// with dummy placeholder data — no Order/Customer lookup, no whatsappSent
// flag, no send-once guard. Unlike the real order-status senders above,
// this THROWS on failure (same convention as sendOtpWhatsApp) so the admin
// "Send Test Message" panel (Settings > Notifications) can show the exact
// Meta error back — that's the entire point of a test button: telling the
// admin WHY a real send would fail (unapproved template, bad credentials,
// missing send permission — see round 1-3 in
// memory/whatsapp_integration_architecture.md) rather than swallowing it.
async function sendTestWhatsappMessage(phoneNumber, event) {
  const params = TEST_PARAMS_BY_EVENT[event];
  if (!params) {
    throw new Error(`Unknown event "${event}" — expected one of ${Object.keys(TEST_PARAMS_BY_EVENT).join(", ")}`);
  }
  const templateName = await getTemplateName(event);
  const languageCode = await getTemplateLanguage();
  return sendTemplateMessage(phoneNumber, templateName, languageCode, [
    { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
  ]);
}

// Sends the OTP via Meta's Authentication template category. Unlike the
// order-status senders above, this THROWS on failure rather than
// swallowing it — it's called from utils/otpProviders/whatsapp.js, which
// (like every other OTP provider — see msg91.js) is expected to throw so
// mobileVerificationController.js's sendOtp surfaces a real error to the
// customer instead of silently pretending an OTP was sent.
//
// Body shape follows Meta's default suggested Authentication template
// (one body parameter — the code — plus a "copy code" quick-reply button
// carrying the same code) — this is what WhatsApp Manager scaffolds by
// default when creating an Authentication-category template. If the
// actually-approved template omits the button (or uses a "one-tap
// autofill" url button instead), update the `components` shape here to
// match — Meta rejects a send whose components don't match the approved
// template's own structure.
async function sendOtpWhatsApp(phoneNumber, otpCode) {
  return sendTemplateMessage(phoneNumber, TEMPLATES.otp, TEMPLATE_LANGUAGE, [
    { type: "body", parameters: [{ type: "text", text: String(otpCode) }] },
    {
      type: "button",
      sub_type: "copy_code",
      index: "0",
      parameters: [{ type: "coupon_code", coupon_code: String(otpCode) }],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Template management (Meta WhatsApp Manager's Message Templates, driven via
// API instead of the manual UI) — not called from anywhere in the request
// path above; only from scripts/submitWhatsappTemplates.js, a deliberately
// standalone, manually-run script (never wired into app startup or any
// route) since submitting content for review against a real Meta Business
// Account is a one-off admin action, not something the app should ever do
// on its own.
// ---------------------------------------------------------------------------

// POST /{waba-id}/message_templates for each draft in TEMPLATE_DRAFTS.
// Meta queues each one for review (typically minutes to ~24h) rather than
// approving synchronously — see listTemplateStatuses() below to check back.
// Does NOT throw on an individual template's failure (e.g. it already
// exists, or Meta rejects the draft outright) — collects every result so
// one bad draft doesn't stop the rest from submitting.
async function submitAllTemplates() {
  const { accessToken, businessAccountId } = await getCredentials();
  if (!businessAccountId) {
    throw new Error("WhatsApp Business Account ID is not configured — set it from Settings > Integrations > WhatsApp");
  }

  const results = [];
  for (const draft of TEMPLATE_DRAFTS) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${businessAccountId}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          language: TEMPLATE_LANGUAGE,
          category: draft.category,
          components: draft.components,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({ name: draft.name, success: false, error: data?.error?.message || `HTTP ${res.status}` });
      } else {
        results.push({ name: draft.name, success: true, id: data.id, status: data.status, category: data.category });
      }
    } catch (err) {
      results.push({ name: draft.name, success: false, error: err.message });
    }
  }
  return results;
}

// GET /{waba-id}/message_templates — current review status of every
// template on the account (not just the 4 this project submitted), so a
// re-run after Meta's review window shows APPROVED/REJECTED/PENDING per
// template without needing the WhatsApp Manager UI open.
async function listTemplateStatuses() {
  const { accessToken, businessAccountId } = await getCredentials();
  if (!businessAccountId) {
    throw new Error("WhatsApp Business Account ID is not configured — set it from Settings > Integrations > WhatsApp");
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${businessAccountId}/message_templates?fields=name,status,category,language,rejected_reason`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  return data.data || [];
}

module.exports = {
  getWebhookVerifyToken,
  getCredentials,
  getTemplateName,
  getTemplateLanguage,
  sendTemplateMessage,
  sendOrderConfirmedWhatsApp,
  sendOrderDispatchedWhatsApp,
  sendOrderOutForDeliveryWhatsApp,
  sendOrderDeliveredWhatsApp,
  sendTestWhatsappMessage,
  sendOtpWhatsApp,
  submitAllTemplates,
  listTemplateStatuses,
  TEMPLATE_DRAFTS,
  DEFAULT_TEMPLATE_NAMES,
  DEFAULT_TEMPLATE_LANGUAGE: TEMPLATE_LANGUAGE,
};
