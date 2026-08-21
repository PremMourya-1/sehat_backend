const { sequelize, Order, OrderItem, ProductVariant } = require("../models");
const { createRefund } = require("./razorpay");
const { sendOrderCancelledEmail } = require("./email");

// Reverses the stock decrement createOrder() applied at order-creation time
// (see controllers/orderController.js) — one increment per line item, same
// variantId/quantity pairing.
async function restockOrderItems(orderId, transaction) {
  const items = await OrderItem.findAll({ where: { orderId }, transaction });
  for (const item of items) {
    await ProductVariant.increment("stock", {
      by: item.quantity,
      where: { id: item.variantId },
      transaction,
    });
  }
}

// Refunds a prepaid+paid order via Razorpay, updating refundStatus/
// refundedAt/refundAmount. Never throws — a refund failure shouldn't leave
// the order stuck mid-cancellation; refundStatus: "failed" instead flags it
// for manual follow-up (e.g. retrying directly from the Razorpay dashboard).
// A no-op (stays "not_applicable", the model default) for every COD order
// and any prepaid order that was never actually paid — nothing to refund.
async function refundIfNeeded(order) {
  if (order.paymentMethod !== "prepaid" || order.paymentStatus !== "paid") {
    return;
  }
  if (!order.razorpayPaymentId) {
    console.error(`Refund: order ${order.orderNumber} is prepaid+paid but has no razorpayPaymentId on record — cannot refund`);
    await order.update({ refundStatus: "failed" });
    return;
  }

  try {
    const refund = await createRefund({
      paymentId: order.razorpayPaymentId,
      amount: order.total,
      notes: { orderId: order.id, orderNumber: order.orderNumber },
    });
    // "processed" is Razorpay's instant-refund outcome; anything else
    // (typically "pending") means it's still working through on their side.
    await order.update({
      refundStatus: refund.status === "processed" ? "completed" : "pending",
      refundedAt: new Date(),
      refundAmount: order.total,
    });
    console.log(`Refund: ${refund.status} for order ${order.orderNumber} (₹${order.total})`);
  } catch (err) {
    console.error(`Refund: failed for order ${order.orderNumber}: ${err.message}`);
    await order.update({ refundStatus: "failed" });
  }
}

// Shared core of both cancellation paths:
// - Customer-initiated (controllers/orderController.js cancelOrder) — only
//   while customerStatus === "confirmed", checked by the caller before this
//   ever runs.
// - Admin-initiated (controllers/adminOrderController.js cancelOrder) — any
//   status; that controller runs the Shiprocket-shipment-cancel step
//   itself, BEFORE calling this, and only calls this if that step succeeded
//   (or wasn't needed) — this function has no Shiprocket awareness at all.
//
// Restock + status update are one transaction (either both happen or
// neither does); the refund/email are external calls that run after it
// commits, same "side effect after the real state change, never blocking
// it" pattern as order creation's emitNewOrder/sendOrderConfirmedEmail.
// Never throws — the caller's own eligibility checks are the last point
// where "can this be cancelled" is decided; once this runs, cancellation
// itself is not allowed to fail out from under the customer/admin.
async function finalizeCancellation(orderId, { cancelledBy, cancellationReason }) {
  await sequelize.transaction(async (t) => {
    await restockOrderItems(orderId, t);
    await Order.update(
      {
        customerStatus: "cancelled",
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason: cancellationReason || null,
      },
      { where: { id: orderId }, transaction: t },
    );
  });

  const order = await Order.findByPk(orderId);
  await refundIfNeeded(order);

  sendOrderCancelledEmail(orderId).catch((err) =>
    console.error(`Email: order-cancelled send threw unexpectedly for order ${order.orderNumber}: ${err.message}`),
  );

  return Order.findByPk(orderId);
}

module.exports = { finalizeCancellation };
