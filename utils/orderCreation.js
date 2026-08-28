const { Order, OrderItem, ProductVariant, Cart, CartItem, Coupon } = require("../models");
const generateOrderNumber = require("./generateOrderNumber");
const { getSiteSettings } = require("./webSettings");

// Builds the real Order + OrderItems (stock decrement, coupon usedCount,
// server-side cart clear) — the one place that actually happens, shared by:
// - COD, which calls this immediately at checkout (see
//   controllers/orderController.js createOrder) — no payment-uncertainty
//   window, so there's nothing to wait for.
// - Prepaid, which calls this only once payment is confirmed (see
//   utils/convertAbandonedCheckout.js) — never at checkout-initiation
//   time, so an unpaid attempt never becomes a real Order.
//
// `lineItems` is the same shape utils/calculateSubtotal.js produces
// (variantId, productId, quantity, price, weight, comboOfferId,
// customMixId, customMixName, rewardTierId, isFreeGift, isMixLine) —
// either fresh (COD) or replayed from an AbandonedCheckout's
// cartItemsSnapshot (prepaid). Must run inside the caller's own
// transaction — this never opens one itself, so the caller decides what
// else (e.g. the AbandonedCheckout delete) shares the same atomic unit.
async function createOrderRecord({
  transaction,
  customerId,
  lineItems,
  subtotal,
  discountAmount,
  shippingCharge,
  total,
  couponCode,
  paymentMethod,
  paymentStatus,
  shippingName,
  shippingPhone,
  alternateMobile,
  shippingAddress,
  shippingCity,
  shippingState,
  shippingPincode,
  razorpayOrderId,
  razorpayPaymentId,
  customerStatus,
  statusHistory,
}) {
  // Snapshotted once, here, so both creation paths (COD immediate, prepaid
  // on-conversion) get it automatically without either caller needing to
  // know about it — see models/Order.js notificationChannel and
  // utils/notifications.js for where this is read back.
  const { notificationChannel } = await getSiteSettings();

  const order = await Order.create(
    {
      orderNumber: generateOrderNumber(),
      customerId,
      subtotal,
      discountAmount,
      shippingCharge,
      couponCode: couponCode || null,
      total,
      paymentMethod,
      ...(paymentStatus ? { paymentStatus } : {}),
      shippingName,
      shippingPhone,
      alternateMobile: alternateMobile || null,
      shippingAddress,
      shippingCity,
      shippingState,
      shippingPincode,
      razorpayOrderId: razorpayOrderId || null,
      razorpayPaymentId: razorpayPaymentId || null,
      ...(customerStatus ? { customerStatus } : {}),
      statusHistory,
      notificationChannel,
    },
    { transaction },
  );

  for (const line of lineItems) {
    await OrderItem.create(
      {
        orderId: order.id,
        productId: line.productId,
        variantId: line.variantId,
        comboOfferId: line.comboOfferId || null,
        customMixId: line.customMixId || null,
        customMixName: line.customMixName || null,
        rewardTierId: line.rewardTierId || null,
        isFreeGift: line.isFreeGift || false,
        weight: line.weight,
        price: line.price,
        quantity: line.quantity,
      },
      { transaction },
    );

    // Mix ingredient grams don't decrement the pack-based stock counter —
    // their availability was already gate-checked up front instead (see
    // utils/calculateMixPricing.js).
    if (line.isMixLine) continue;

    await ProductVariant.decrement("stock", {
      by: line.quantity,
      where: { id: line.variantId },
      transaction,
    });
  }

  if (couponCode) {
    await Coupon.increment("usedCount", { where: { code: couponCode }, transaction });
  }

  const cart = await Cart.findOne({ where: { customerId }, transaction });
  if (cart) await CartItem.destroy({ where: { cartId: cart.id }, transaction });

  return order;
}

module.exports = { createOrderRecord };
