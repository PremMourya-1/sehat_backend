const { sequelize, AbandonedCheckout, Order, ProductVariant } = require("../models");
const { createOrderRecord } = require("./orderCreation");
const { createRefund } = require("./razorpay");

// Shared by BOTH payment-confirmation paths — the frontend's verify-payment
// callback (controllers/checkoutController.js verifyPayment) and the
// Razorpay webhook fallback (controllers/webhookController.js
// razorpayWebhook) — since either one might be what actually confirms a
// given payment first. This is the ONLY place a prepaid Order gets
// created: converts a "pending" AbandonedCheckout into a real Order, and
// deletes the AbandonedCheckout row, all in one transaction.
//
// `customerId`, when passed, is an ownership guard for the customer-facing
// path (a customer verifying someone else's razorpayOrderId should never
// succeed) — the webhook path omits it entirely, since a valid webhook
// signature is itself the authentication there, not a logged-in customer.
//
// Race safety: a row lock on the AbandonedCheckout means only the first of
// the two paths to arrive actually converts it — the second sees the row
// already gone and, given a matching Order now exists, reports
// alreadyConverted instead of erroring.
//
// Returns one of:
//   { success: true, order, alreadyConverted }
//   { success: false, reason: "not_found" }
//   { success: false, reason: "stock_unavailable", message }
async function convertAbandonedCheckout(razorpayOrderId, razorpayPaymentId, { customerId } = {}) {
  let order = null;
  let notFound = false;
  let stockFailure = null;
  let refundDetails = null;

  await sequelize.transaction(async (t) => {
    const checkout = await AbandonedCheckout.findOne({
      where: { razorpayOrderId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!checkout || (customerId && checkout.customerId !== customerId)) {
      notFound = true;
      return;
    }

    // Time has passed since checkout initiation — someone else may have
    // bought the last unit while this payment was in flight. Mix
    // ingredient lines skip this, same as createOrderRecord's own
    // decrement skip (no pack-based stock to check).
    for (const line of checkout.cartItemsSnapshot || []) {
      if (line.isMixLine) continue;
      const variant = await ProductVariant.findByPk(line.variantId, { transaction: t });
      if (!variant || variant.stock < line.quantity) {
        stockFailure = "One or more items in this order are no longer in stock";
        refundDetails = { paymentId: razorpayPaymentId, amount: Number(checkout.totalAmount) };
        break;
      }
    }
    if (stockFailure) return;

    order = await createOrderRecord({
      transaction: t,
      customerId: checkout.customerId,
      lineItems: checkout.cartItemsSnapshot || [],
      subtotal: checkout.subtotal,
      discountAmount: checkout.discountAmount,
      shippingCharge: checkout.shippingCharge,
      total: checkout.totalAmount,
      couponCode: checkout.couponCode,
      paymentMethod: "prepaid",
      paymentStatus: "paid",
      ...checkout.shippingDetails,
      razorpayOrderId,
      razorpayPaymentId,
      customerStatus: "confirmed",
      statusHistory: { confirmed: new Date() },
    });

    await checkout.destroy({ transaction: t });
  });

  if (stockFailure) {
    // Payment succeeded but there's nothing to fulfill it with — refund
    // automatically rather than leave the customer charged with no order,
    // and keep the AbandonedCheckout (re-marked "expired") as a record of
    // what happened instead of it just vanishing.
    let refundNote = "refund pending";
    try {
      const refund = await createRefund({
        paymentId: refundDetails.paymentId,
        amount: refundDetails.amount,
        notes: { reason: "stock_unavailable", razorpayOrderId },
      });
      refundNote = refund.status === "processed" ? "refund processed" : `refund ${refund.status}`;
    } catch (err) {
      console.error(`convertAbandonedCheckout: auto-refund failed for payment ${refundDetails.paymentId}: ${err.message}`);
      refundNote = "refund FAILED — needs manual follow-up in the Razorpay dashboard";
    }

    await AbandonedCheckout.update(
      {
        status: "expired",
        failureNote: `Payment ${razorpayPaymentId} succeeded but stock ran out before conversion — ${refundNote}`,
      },
      { where: { razorpayOrderId } },
    );

    return { success: false, reason: "stock_unavailable", message: stockFailure };
  }

  if (notFound) {
    // Either a genuinely unknown razorpayOrderId, or the OTHER path just
    // won the race and already converted it — tell those two apart by
    // checking whether a matching Order now exists.
    const existing = await Order.findOne({
      where: { razorpayOrderId, ...(customerId ? { customerId } : {}) },
    });
    if (existing) return { success: true, order: existing, alreadyConverted: true };
    return { success: false, reason: "not_found" };
  }

  return { success: true, order, alreadyConverted: false };
}

module.exports = { convertAbandonedCheckout };
