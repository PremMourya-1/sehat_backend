const { Order } = require("../models");
const { sendOrderConfirmedEmail, sendOrderPackedEmail, sendOrderOutForDeliveryEmail, sendOrderDeliveredEmail } = require("./email");
const {
  sendOrderConfirmedWhatsApp,
  sendOrderDispatchedWhatsApp,
  sendOrderOutForDeliveryWhatsApp,
  sendOrderDeliveredWhatsApp,
} = require("./whatsapp");

// Single-channel order-status notification dispatch. Each order snapshots
// WebSettings' notificationChannel ("email" | "whatsapp") once, at creation
// time (see utils/orderCreation.js createOrderRecord, which reads
// utils/webSettings.js) into its own Order.notificationChannel — never
// changed afterward, so an order keeps using whichever channel was active
// when it was placed even if the admin flips the site-wide setting later.
// These four functions are what every trigger point below now calls
// instead of firing both sendOrderXEmail AND sendOrderXWhatsApp in
// parallel (the previous behavior) — same never-throws contract as the
// underlying senders they wrap, so callers can keep fire-and-forgetting
// exactly as before.
//
// All 4 order-status events (confirmed/dispatched/out-for-delivery/
// delivered) now have a WhatsApp counterpart — cancelled is the only one
// that doesn't (see utils/orderCancellation.js, untouched, always email).
// Which Meta-approved template NAME each WhatsApp send actually uses is
// itself admin-configurable (Settings > Integrations > WhatsApp) — see
// utils/whatsapp.js getTemplateName(); this dispatcher only decides EMAIL
// vs WHATSAPP, not which template.
async function getNotificationChannel(orderId) {
  const order = await Order.findByPk(orderId, { attributes: ["notificationChannel"] });
  // Orders created before this field existed (or any edge case where the
  // snapshot didn't happen) read back null — default to "email", the
  // channel every order effectively used before this setting existed.
  return order?.notificationChannel === "whatsapp" ? "whatsapp" : "email";
}

async function notifyOrderConfirmed(orderId) {
  const channel = await getNotificationChannel(orderId);
  return channel === "whatsapp" ? sendOrderConfirmedWhatsApp(orderId) : sendOrderConfirmedEmail(orderId);
}

async function notifyOrderDispatched(orderId) {
  const channel = await getNotificationChannel(orderId);
  return channel === "whatsapp" ? sendOrderDispatchedWhatsApp(orderId) : sendOrderPackedEmail(orderId);
}

async function notifyOrderOutForDelivery(orderId) {
  const channel = await getNotificationChannel(orderId);
  return channel === "whatsapp" ? sendOrderOutForDeliveryWhatsApp(orderId) : sendOrderOutForDeliveryEmail(orderId);
}

async function notifyOrderDelivered(orderId) {
  const channel = await getNotificationChannel(orderId);
  return channel === "whatsapp" ? sendOrderDeliveredWhatsApp(orderId) : sendOrderDeliveredEmail(orderId);
}

module.exports = { notifyOrderConfirmed, notifyOrderDispatched, notifyOrderOutForDelivery, notifyOrderDelivered };
