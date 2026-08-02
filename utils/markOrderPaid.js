const { Order } = require("../models");
const { fulfillOrderShipment } = require("./shiprocket");

// Shared by both the frontend payment-verification endpoint and the
// Razorpay webhook fallback, since either one might be what actually
// confirms a given payment first (see checkoutController.verifyPayment /
// webhookController.razorpayWebhook). Marks the order paid and runs the
// same shipment pipeline COD orders get once confirmed — never duplicated
// per payment_status.
//
// The UPDATE ... WHERE paymentStatus = "pending" is the atomicity: if both
// paths race, only one of them actually flips the row (Postgres serializes
// concurrent UPDATEs on the same row), so only one ever calls
// fulfillOrderShipment().
async function markOrderPaidAndFulfill(orderId, razorpayPaymentId) {
  const [affected] = await Order.update(
    { paymentStatus: "paid", razorpayPaymentId, status: "processing" },
    { where: { id: orderId, paymentStatus: "pending" } },
  );

  if (affected === 0) {
    return { alreadyPaid: true };
  }

  const order = await Order.findByPk(orderId);
  if (order.shipmentStatus !== "created") {
    await fulfillOrderShipment(orderId);
  }

  return { alreadyPaid: false };
}

module.exports = { markOrderPaidAndFulfill };
