const { Order } = require("../models");

// Shared by both the frontend payment-verification endpoint and the
// Razorpay webhook fallback, since either one might be what actually
// confirms a given payment first (see checkoutController.verifyPayment /
// webhookController.razorpayWebhook). Only marks the order paid — it does
// NOT touch order.status or push to Shiprocket. Shiprocket fulfillment is
// never automatic; it only ever runs from the admin's explicit "Generate
// Label" action (see utils/shiprocket.js generateLabelAndFulfill).
//
// The UPDATE ... WHERE paymentStatus = "pending" is the atomicity: if both
// paths race, only one of them actually flips the row (Postgres serializes
// concurrent UPDATEs on the same row).
async function markOrderPaid(orderId, razorpayPaymentId) {
  const [affected] = await Order.update(
    { paymentStatus: "paid", razorpayPaymentId },
    { where: { id: orderId, paymentStatus: "pending" } },
  );

  return { alreadyPaid: affected === 0 };
}

module.exports = { markOrderPaid };
