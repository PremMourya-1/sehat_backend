const { Order } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { checkPincodeServiceability } = require("../utils/shiprocket");
const { resolvePincodeLocation } = require("../utils/pincodeResolver");
const { getShippingCharge } = require("../utils/shippingZones");
const calculateSubtotal = require("../utils/calculateSubtotal");
const { getCodAvailability } = require("../utils/checkCodAvailability");
const { getRazorpayCredentials, verifyPaymentSignature } = require("../utils/razorpay");
const { markOrderPaid } = require("../utils/markOrderPaid");
const { emitNewOrder } = require("../utils/socket");
const { sendOrderConfirmedEmail } = require("../utils/email");
const { getSiteSettings } = require("../utils/webSettings");

const PINCODE_REGEX = /^[0-9]{6}$/;

// GET /api/checkout/config — public, no auth (read before the customer is
// necessarily even logged in, same as check-pincode above). Currently just
// the mobile-verification toggle (see utils/webSettings.js) — the
// checkout page reads this to decide whether to show the OTP-verify-your-
// mobile gate (Components/Checkout/MobileVerification.js) at all before
// the shipping form, or skip straight to it.
exports.getCheckoutConfig = asyncHandler(async (req, res) => {
  const settings = await getSiteSettings();
  return sendSuccess(res, { mobileVerificationRequired: settings.mobileVerificationRequired });
});

// GET /api/checkout/check-pincode?pincode=XXXXXX — public, no auth. Used by
// the product page's "Check delivery" widget AND checkout's Step 1 (see
// utils/shiprocket.js checkPincodeServiceability). Also resolves the
// shipping charge for a serviceable pincode so checkout can show it in the
// order summary before the customer places the order — the same
// getShippingCharge(state) call orderController.createOrder makes again at
// order-creation time (that one is authoritative; this is a preview).
exports.checkPincode = asyncHandler(async (req, res) => {
  const { pincode } = req.query;
  if (!pincode || !PINCODE_REGEX.test(pincode)) {
    return sendError(res, "A valid 6-digit pincode is required", 400);
  }

  const result = await checkPincodeServiceability(pincode);
  if (!result.serviceable) {
    return sendSuccess(res, { ...result, shippingCharge: 0 });
  }

  const location = await resolvePincodeLocation(pincode);
  const shippingCharge = await getShippingCharge(location?.state);
  return sendSuccess(res, { ...result, shippingCharge });
});

// POST /api/checkout/cod-availability  { items: [{ variantId, quantity }] }
// public, no auth. Lets checkout know whether to offer COD at all for the
// customer's current cart, before they attempt to place the order (see
// utils/checkCodAvailability.js — site-wide toggle + per-product override).
exports.checkCodAvailability = asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return sendError(res, "items are required", 400);
  }

  const subtotalResult = await calculateSubtotal(items);
  if (subtotalResult.error) return sendError(res, subtotalResult.error, 400);

  const result = await getCodAvailability(subtotalResult.items);
  return sendSuccess(res, result);
});

// POST /api/checkout/verify-payment  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Requires customerAuth (see routes/checkoutRoutes.js) — scopes the lookup
// to the calling customer's own order. Called by the frontend right after
// Razorpay's checkout.js `handler` callback fires with these three fields.
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature } =
    req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return sendError(res, "Missing payment verification fields", 400);
  }

  const order = await Order.findOne({ where: { razorpayOrderId, customerId: req.customer.id } });
  if (!order) {
    return sendError(res, "Order not found for this payment", 404);
  }

  if (order.paymentStatus === "paid") {
    return sendSuccess(res, order, "Payment already verified");
  }

  const { keySecret } = await getRazorpayCredentials();
  const isValid = verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret });

  if (!isValid) {
    console.error(
      `Razorpay: signature mismatch verifying payment for order ${order.orderNumber} (razorpay order ${razorpayOrderId}, payment ${razorpayPaymentId})`,
    );
    return sendError(res, "Payment verification failed", 400);
  }

  const { alreadyPaid } = await markOrderPaid(order.id, razorpayPaymentId);
  await order.reload();

  // Only notify the admin once, for whichever path (frontend callback here,
  // or the webhook fallback) actually flips the order to paid first.
  if (!alreadyPaid) {
    emitNewOrder(order).catch((err) => console.error(`Failed to emit new-order notification: ${err.message}`));
    sendOrderConfirmedEmail(order.id).catch((err) =>
      console.error(`Email: order-confirmed send threw unexpectedly for order ${order.orderNumber}: ${err.message}`),
    );
  }

  return sendSuccess(res, order, "Payment verified successfully");
});
