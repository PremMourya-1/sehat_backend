const { sequelize, Order, OrderItem, ProductVariant } = require("../models");

// Shared by both the frontend payment-verification endpoint and the
// Razorpay webhook fallback, since either one might be what actually
// confirms a given payment first (see checkoutController.verifyPayment /
// webhookController.razorpayWebhook). Only marks the order paid and moves
// it to "confirmed" — it does NOT touch order.status or push to Shiprocket.
// Shiprocket fulfillment is never automatic; it only ever runs from the
// admin's explicit "Generate Label" action (see utils/shiprocket.js
// generateLabelAndFulfill).
//
// This is also the ONLY place a prepaid order's stock actually decrements
// (see controllers/orderController.js createOrder, which deliberately
// skips it for prepaid) — so a payment that never completes never held
// stock hostage in the meantime. Mix ingredient lines (customMixId set)
// are skipped here too, same as at order creation — gram amounts don't map
// onto the pack-based stock counter.
//
// Everything (the paid/confirmed flip, statusHistory, and the stock
// decrement) happens in one transaction under a row lock, which is the
// atomicity: if the frontend's verify-payment callback and the webhook
// fallback both race in for the same order, only the first to acquire the
// lock actually applies any of this — the second sees paymentStatus
// already "paid" and no-ops, so stock can never double-decrement.
async function markOrderPaid(orderId, razorpayPaymentId) {
  let alreadyPaid = false;

  await sequelize.transaction(async (t) => {
    const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!order || order.paymentStatus === "paid") {
      alreadyPaid = true;
      return;
    }

    await order.update(
      {
        paymentStatus: "paid",
        razorpayPaymentId,
        customerStatus: "confirmed",
        statusHistory: { ...(order.statusHistory || {}), confirmed: new Date() },
      },
      { transaction: t },
    );

    if (order.paymentMethod === "prepaid") {
      const items = await OrderItem.findAll({ where: { orderId }, transaction: t });
      for (const item of items) {
        if (item.customMixId) continue;
        await ProductVariant.decrement("stock", {
          by: item.quantity,
          where: { id: item.variantId },
          transaction: t,
        });
      }
    }
  });

  return { alreadyPaid };
}

module.exports = { markOrderPaid };
