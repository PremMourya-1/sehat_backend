const { sequelize, Order, OrderItem, Product, ProductVariant, ComboOffer, CartRewardTier, ProductReview, AbandonedCheckout } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const calculateSubtotal = require("../utils/calculateSubtotal");
const evaluateCoupon = require("../utils/evaluateCoupon");
const generateOrderNumber = require("../utils/generateOrderNumber");
const { checkPincodeServiceability, parseWeightToKg } = require("../utils/shiprocket");
const { resolvePincodeLocation } = require("../utils/pincodeResolver");
const { getCodAvailability } = require("../utils/checkCodAvailability");
const { createRazorpayOrder, getRazorpayCredentials } = require("../utils/razorpay");
const { emitNewOrder } = require("../utils/socket");
const { notifyOrderConfirmed } = require("../utils/notifications");
const { getShippingCharge } = require("../utils/shippingZones");
const { finalizeCancellation } = require("../utils/orderCancellation");
const { createOrderRecord } = require("../utils/orderCreation");

const PINCODE_REGEX = /^[0-9]{6}$/;
const MIN_ORDER_WEIGHT_KG = 0.1;
const PAYMENT_METHODS = ["cod", "prepaid"];

// Exported (not just used locally) — controllers/checkoutController.js's
// verifyPayment needs this exact same shape for the Order it returns right
// after a successful payment converts an AbandonedCheckout, so the
// frontend gets identical data whichever endpoint it came from.
const orderItemIncludes = [
  {
    model: OrderItem,
    include: [
      { model: Product, attributes: ["id", "name", "image"] },
      { model: ComboOffer, attributes: ["id", "title"] },
      { model: CartRewardTier, as: "rewardTier", attributes: ["id", "label"] },
    ],
  },
];
exports.orderItemIncludes = orderItemIncludes;

const MOBILE_REGEX = /^[0-9]{10}$/;

// POST /api/orders
// body: { items: [{ variantId, quantity, comboOfferId? }], customMixes?: [{ name?, items: [{ productId, grams }] }],
//         couponCode?, shippingName, shippingPhone, alternateMobile?, shippingAddress, shippingPincode,
//         paymentMethod? ("cod" | "prepaid", defaults to "cod") }
// A combo purchase is submitted pre-expanded into its real product/variant
// lines (see sehat-potli-front's Utils/cartExpansion.js) tagged with the
// combo's id — each still goes through normal stock/weight/COD handling
// below as a real line item; only the pricing (see calculateSubtotal)
// treats the tagged group specially. A Build Your Own Mix instance is
// submitted separately in `customMixes` (grams, not pack quantities) —
// calculateSubtotal prices and flattens it into the same lineItems shape,
// tagged `isMixLine: true`, which this function reads below to skip stock
// decrement (see utils/calculateMixPricing.js for why: gram amounts don't
// map cleanly onto the pack-based stock counter, so availability is gated
// up front there instead of decremented here).
// shippingCity/shippingState are never taken from the client — the customer
// only ever enters/confirms a pincode (checked up front on the product page,
// see checkoutController.checkPincode); city/state are resolved server-side
// below via resolvePincodeLocation() so Shiprocket's order payload has them.
exports.createOrder = asyncHandler(async (req, res) => {
  const {
    items,
    customMixes,
    couponCode,
    shippingName,
    shippingPhone,
    alternateMobile,
    shippingAddress,
    shippingPincode,
    paymentMethod = "cod",
  } = req.body;

  if ((!Array.isArray(items) || items.length === 0) && (!Array.isArray(customMixes) || customMixes.length === 0)) {
    return sendError(res, "Order must contain at least one item", 400);
  }
  if (!shippingName || !shippingPhone || !shippingAddress || !shippingPincode) {
    return sendError(res, "Complete shipping details are required", 400);
  }
  if (!PINCODE_REGEX.test(shippingPincode)) {
    return sendError(res, "A valid 6-digit pincode is required", 400);
  }
  if (alternateMobile && !MOBILE_REGEX.test(alternateMobile)) {
    return sendError(res, "Alternate mobile number must be a valid 10-digit number", 400);
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return sendError(res, `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`, 400);
  }

  const subtotalResult = await calculateSubtotal(items || [], customMixes || []);
  if (subtotalResult.error) return sendError(res, subtotalResult.error, 400);

  const { subtotal, items: rawLineItems, comboDiscount } = subtotalResult;

  // Combo savings (subtotal, computed from each item's real price, minus
  // what the combo actually charges — see utils/calculateSubtotal.js) fold
  // straight into the same discountAmount a coupon would use, so `total`
  // below needs no separate combo-aware formula.
  let discountAmount = comboDiscount || 0;
  let appliedCoupon = null;
  if (couponCode) {
    const couponResult = await evaluateCoupon(couponCode, subtotal);
    if (couponResult.error) return sendError(res, couponResult.error, 400);
    discountAmount += couponResult.discountAmount;
    appliedCoupon = couponResult.coupon;
  }

  // Resolved early (moved ahead of the serviceability check below) since
  // shippingCharge — derived from the resolved state, see
  // utils/shippingZones.js — has to be folded into `total` before that
  // check runs, not just before the order is created; `total` doubles as
  // the COD-amount estimate Shiprocket's serviceability call uses.
  const location = await resolvePincodeLocation(shippingPincode);
  if (!location) {
    return sendError(res, "Could not verify this pincode — please check and try again", 400);
  }

  const shippingCharge = await getShippingCharge(location.state);
  const total = Number((subtotal - discountAmount + shippingCharge).toFixed(2));

  // Validate stock availability before committing the order. Mix ingredient
  // lines are skipped here — their availability was already gate-checked
  // (in stock at all, yes/no) inside calculateMixPricing.js, since their
  // gram amount has no clean relationship to this pack-count check.
  // Free-gift reward lines (see utils/calculateSubtotal.js) get a softer
  // failure mode than everything else: this is one final live stock check
  // since calculateSubtotal's own check may be stale by now (cart preview
  // vs. actual order placement) — if it lost the race, the gift line is
  // silently dropped rather than blocking the whole paid order over a free
  // extra.
  const lineItems = [];
  for (const line of rawLineItems) {
    if (line.isMixLine) {
      lineItems.push(line);
      continue;
    }
    const variant = await ProductVariant.findByPk(line.variantId);
    if (!variant || variant.stock < line.quantity) {
      if (line.isFreeGift) continue;
      return sendError(res, `Insufficient stock for one of the selected items`, 400);
    }
    lineItems.push(line);
  }

  // Defense in depth: the storefront already gates Buy Now/checkout behind
  // a serviceable pincode check, but a client-side gate is never trusted
  // alone — re-verify here with the order's real weight/COD amount.
  const totalWeightKg = Math.max(
    lineItems.reduce((sum, line) => sum + parseWeightToKg(line.weight) * line.quantity, 0),
    MIN_ORDER_WEIGHT_KG,
  );
  const serviceability = await checkPincodeServiceability(shippingPincode, totalWeightKg, total);
  if (!serviceability.serviceable) {
    return sendError(res, "Sorry, delivery isn't available to this pincode", 400);
  }

  // Defense in depth again: checkout only shows COD as selectable when it's
  // actually available, but never trust that alone — re-verify here too.
  if (paymentMethod === "cod") {
    const codAvailability = await getCodAvailability(lineItems);
    if (!codAvailability.available) {
      return sendError(res, codAvailability.reason || "Cash on Delivery is not available for this order", 400);
    }
  }

  const shippingDetails = {
    shippingName,
    shippingPhone,
    alternateMobile: alternateMobile || null,
    shippingAddress,
    shippingCity: location.city,
    shippingState: location.state,
    shippingPincode,
  };
  const resolvedCouponCode = appliedCoupon ? appliedCoupon.code : null;

  // COD: a real Order, right now — no payment step to wait on, so nothing
  // about this branch changed from before.
  if (paymentMethod === "cod") {
    let orderId;
    try {
      await sequelize.transaction(async (t) => {
        const order = await createOrderRecord({
          transaction: t,
          customerId: req.customer.id,
          lineItems,
          subtotal,
          discountAmount,
          shippingCharge,
          total,
          couponCode: resolvedCouponCode,
          paymentMethod: "cod",
          ...shippingDetails,
          statusHistory: { confirmed: new Date() },
        });
        orderId = order.id;
      });
    } catch (err) {
      console.error(`Order creation failed: ${err.message}`);
      return sendError(res, "Could not place order — please try again", 400);
    }

    const fullOrder = await Order.findByPk(orderId, { include: orderItemIncludes });
    emitNewOrder(fullOrder).catch((err) => console.error(`Failed to emit new-order notification: ${err.message}`));
    notifyOrderConfirmed(fullOrder.id).catch((err) =>
      console.error(`Notification: order-confirmed send threw unexpectedly for order ${fullOrder.orderNumber}: ${err.message}`),
    );
    return sendSuccess(res, { ...fullOrder.toJSON(), razorpay: null }, "Order placed successfully", 201);
  }

  // Prepaid: NO Order is created here — only an AbandonedCheckout, holding
  // everything needed to build the real Order later (see
  // utils/convertAbandonedCheckout.js). This is the whole point of this
  // flow: a checkout the customer never actually pays for (closed the
  // Razorpay popup, tab crash, card declined) must never become a real
  // Order counted in the Orders list or dashboard revenue — stock is
  // never touched either, for the same reason. Nothing here needs a
  // transaction — it's a single insert, not the multi-row write COD's
  // branch above is.
  let abandonedCheckoutId;
  let checkoutReference;
  let razorpayInit;
  try {
    const { keyId } = await getRazorpayCredentials();
    // Not a real Order yet, so there's no real orderNumber — this is just a
    // display-only reference for Razorpay's payment sheet and the
    // frontend's pre-payment UI (retry banner, etc). Once payment succeeds,
    // the real Order gets its own real orderNumber (see
    // utils/convertAbandonedCheckout.js), independent of this string.
    checkoutReference = generateOrderNumber();
    const razorpayOrder = await createRazorpayOrder({
      amount: total,
      receipt: checkoutReference,
      notes: { customerId: req.customer.id },
    });

    const checkout = await AbandonedCheckout.create({
      customerId: req.customer.id,
      cartItemsSnapshot: lineItems,
      shippingDetails,
      subtotal,
      discountAmount,
      shippingCharge,
      totalAmount: total,
      couponCode: resolvedCouponCode,
      razorpayOrderId: razorpayOrder.id,
      status: "pending",
    });

    abandonedCheckoutId = checkout.id;
    razorpayInit = { razorpayOrderId: razorpayOrder.id, razorpayKeyId: keyId, amount: razorpayOrder.amount };
  } catch (err) {
    console.error(`Checkout initiation failed: ${err.message}`);
    return sendError(res, "Could not initiate online payment — please try again or choose Cash on Delivery", 400);
  }

  return sendSuccess(res, { abandonedCheckoutId, checkoutReference, razorpay: razorpayInit }, "Payment initiated", 201);
});

// GET /api/orders?page=&limit=
exports.getMyOrders = asyncHandler(async (req, res) => {
  const page = req.query.page ? Math.max(Number(req.query.page), 1) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  const offset = (page - 1) * limit;

  const { rows, count } = await Order.findAndCountAll({
    where: { customerId: req.customer.id },
    include: orderItemIncludes,
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return sendSuccess(res, {
    orders: rows,
    page,
    limit,
    total: count,
    totalPages: Math.ceil(count / limit),
  });
});

// GET /api/orders/recent — non-paginated, in-progress orders only
exports.getRecentOrders = asyncHandler(async (req, res) => {
  const orders = await Order.findAll({
    where: {
      customerId: req.customer.id,
      status: ["pending", "processing", "shipped"],
    },
    include: orderItemIncludes,
    order: [["createdAt", "DESC"]],
  });

  return sendSuccess(res, orders);
});

// GET /api/orders/last-shipping — just the shipping fields off the
// customer's single most recent order (any status — even a cancelled one
// still had a real, presumably-correct address), for checkout's
// autofill-from-last-order feature. Returns null (not 404) when the
// customer has no past orders yet, so the frontend can just treat "no
// autofill" as the normal empty-checkout-form case rather than an error.
exports.getLastOrderShipping = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    where: { customerId: req.customer.id },
    attributes: ["shippingName", "shippingPhone", "alternateMobile", "shippingAddress", "shippingPincode"],
    order: [["createdAt", "DESC"]],
  });

  return sendSuccess(res, order || null);
});

// GET /api/orders/:id — includes everything the list endpoint above does,
// plus courierName/awbCode (already plain Order columns) and a computed
// trackingUrl for the "Track on Shiprocket" link on the order detail page.
// Shiprocket's public tracking page is keyed by AWB code alone (no account
// login needed on the customer's side), so trackingUrl is null until an AWB
// has actually been assigned (see utils/shiprocket.js assignAWBWithRetry).
// Once delivered, also resolves `reviewedProductIds` — every productId this
// customer has already reviewed for THIS specific order — so the frontend's
// "Rate this product" prompt (see Components/Account/ReviewPrompt.js) only
// ever shows for items not yet reviewed.
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    where: { id: req.params.id, customerId: req.customer.id },
    include: orderItemIncludes,
  });
  if (!order) return sendError(res, "Order not found", 404);

  let reviewedProductIds = [];
  if (order.customerStatus === "delivered") {
    const reviews = await ProductReview.findAll({
      where: { orderId: order.id, customerId: req.customer.id },
      attributes: ["productId"],
      raw: true,
    });
    reviewedProductIds = reviews.map((r) => r.productId);
  }

  const trackingUrl = order.awbCode ? `https://shiprocket.co/tracking/${order.awbCode}` : null;

  // Lets the order detail page reopen Razorpay's checkout for a
  // "payment_pending" order (see Components — retryOrderPayment on the
  // frontend) without a separate config endpoint. keyId is Razorpay's own
  // public identifier (not the secret) — safe to expose to the customer,
  // same as it already is in the order-creation response.
  let razorpayKeyId = null;
  if (order.paymentMethod === "prepaid" && order.customerStatus === "payment_pending") {
    try {
      razorpayKeyId = (await getRazorpayCredentials()).keyId;
    } catch (err) {
      console.error(`getOrderById: could not resolve Razorpay keyId for retry: ${err.message}`);
    }
  }

  return sendSuccess(res, { ...order.toJSON(), trackingUrl, reviewedProductIds, razorpayKeyId });
});

// POST /api/orders/:id/cancel  { reason? }
// Customer self-cancel — only while customerStatus is still "confirmed",
// i.e. before admin's "Generate Label" action has pushed the order to
// Shiprocket at all. Once dispatched, a courier is already involved, so
// self-cancel is intentionally no longer offered (the customer needs to
// contact support instead) — re-validated here server-side, never trusted
// from whatever the frontend's button visibility already implied.
exports.cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const order = await Order.findOne({ where: { id: req.params.id, customerId: req.customer.id } });
  if (!order) return sendError(res, "Order not found", 404);

  if (order.customerStatus !== "confirmed") {
    return sendError(
      res,
      order.customerStatus === "cancelled"
        ? "This order is already cancelled"
        : "This order can no longer be self-cancelled — please contact support",
      400,
    );
  }

  const cancelled = await finalizeCancellation(order.id, {
    cancelledBy: "customer",
    cancellationReason: reason ? String(reason).trim() : null,
  });

  return sendSuccess(res, cancelled, "Order cancelled successfully");
});
