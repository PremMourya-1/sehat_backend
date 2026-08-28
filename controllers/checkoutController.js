const { Order } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { checkPincodeServiceability } = require("../utils/shiprocket");
const { resolvePincodeLocation } = require("../utils/pincodeResolver");
const { getShippingCharge } = require("../utils/shippingZones");
const calculateSubtotal = require("../utils/calculateSubtotal");
const { getCodAvailability } = require("../utils/checkCodAvailability");
const { getRazorpayCredentials, verifyPaymentSignature } = require("../utils/razorpay");
const { convertAbandonedCheckout } = require("../utils/convertAbandonedCheckout");
const { orderItemIncludes } = require("./orderController");
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

// POST /api/checkout/cod-availability  { items: [{ variantId, quantity }], customMixes?: [...] }
// public, no auth. Lets checkout know whether to offer COD at all for the
// customer's current cart, before they attempt to place the order (see
// utils/checkCodAvailability.js — site-wide toggle + per-product override).
exports.checkCodAvailability = asyncHandler(async (req, res) => {
  const { items, customMixes } = req.body;
  if ((!Array.isArray(items) || items.length === 0) && (!Array.isArray(customMixes) || customMixes.length === 0)) {
    return sendError(res, "items are required", 400);
  }

  const subtotalResult = await calculateSubtotal(items || [], customMixes || []);
  if (subtotalResult.error) return sendError(res, subtotalResult.error, 400);

  const result = await getCodAvailability(subtotalResult.items);
  return sendSuccess(res, result);
});

// POST /api/checkout/verify-payment  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Requires customerAuth (see routes/checkoutRoutes.js). Called by the
// frontend right after Razorpay's checkout.js `handler` callback fires
// with these three fields. No Order exists yet at this point for a prepaid
// checkout — this is the moment one gets created (see
// utils/convertAbandonedCheckout.js), not an update to an existing row.
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature } =
    req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return sendError(res, "Missing payment verification fields", 400);
  }

  const { keySecret } = await getRazorpayCredentials();
  const isValid = verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret });

  if (!isValid) {
    console.error(
      `Razorpay: signature mismatch verifying payment for razorpay order ${razorpayOrderId} (payment ${razorpayPaymentId})`,
    );
    return sendError(res, "Payment verification failed", 400);
  }

  const result = await convertAbandonedCheckout(razorpayOrderId, razorpayPaymentId, { customerId: req.customer.id });

  if (!result.success) {
    if (result.reason === "stock_unavailable") {
      return sendError(
        res,
        "Your payment succeeded, but one or more items in your order are no longer available. Your payment is being refunded automatically — please contact support if you don't see the refund within a few days.",
        409,
      );
    }
    return sendError(res, "Checkout not found for this payment", 404);
  }

  // Only notify the admin once, for whichever path (frontend callback here,
  // or the webhook fallback) actually converts the checkout first.
  if (!result.alreadyConverted) {
    emitNewOrder(result.order).catch((err) => console.error(`Failed to emit new-order notification: ${err.message}`));
    sendOrderConfirmedEmail(result.order.id).catch((err) =>
      console.error(`Email: order-confirmed send threw unexpectedly for order ${result.order.orderNumber}: ${err.message}`),
    );
  }

  const fullOrder = await Order.findByPk(result.order.id, { include: orderItemIncludes });
  return sendSuccess(res, fullOrder, "Payment verified successfully");
});
