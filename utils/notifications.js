const { Order } = require("../models");
const { sendOrderConfirmedEmail, sendOrderPackedEmail, sendOrderDeliveredEmail } = require("./email");
const { sendOrderConfirmedWhatsApp, sendOrderDispatchedWhatsApp, sendOrderDeliveredWhatsApp } = require("./whatsapp");

// Single-channel order-status notification dispatch. Each order snapshots
// WebSettings' notificationChannel ("email" | "whatsapp") once, at creation
// time (see utils/orderCreation.js createOrderRecord, which reads
// utils/webSettings.js) into its own Order.notificationChannel — never
// changed afterward, so an order keeps using whichever channel was active
// when it was placed even if the admin flips the site-wide setting later.
// These three functions are what every trigger point below now calls
// instead of firing both sendOrderXEmail AND sendOrderXWhatsApp in
// parallel (the previous behavior) — same never-throws contract as the
// underlying senders they wrap, so callers can keep fire-and-forgetting
// exactly as before.
//
// Only 3 events have a WhatsApp counterpart at all (order_confirmed/
// order_dispatched/order_delivered templates) — out-for-delivery and
// cancelled emails have no WhatsApp template and are NOT routed through
// here, they keep sending unconditionally via email regardless of channel
// (see utils/shiprocket.js's out_for_delivery branch and
// utils/orderCancellation.js).
//
// TEMPORARY: only the order_confirmed WhatsApp template is Meta-approved
// so far (order_dispatched/order_delivered are still pending review — see
// memory/whatsapp_integration_architecture.md). An order on the
// "whatsapp" channel gets a real order-confirmed WhatsApp message today,
// but its dispatched/delivered WhatsApp sends will fail cleanly (Meta
// rejects an unapproved/unknown template name — sendOrderDispatchedWhatsApp/
// sendOrderDeliveredWhatsApp already log the error and return
// { success: false }, same as any other send failure) rather than block
// anything. Nothing here needs to change once the remaining templates are
// approved — delete this paragraph then.
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

async function notifyOrderDelivered(orderId) {
  const channel = await getNotificationChannel(orderId);
  return channel === "whatsapp" ? sendOrderDeliveredWhatsApp(orderId) : sendOrderDeliveredEmail(orderId);
}

module.exports = { notifyOrderConfirmed, notifyOrderDispatched, notifyOrderDelivered };
