const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const evaluateCoupon = require("../utils/evaluateCoupon");

// POST /api/coupons/apply  { code, subtotal }
exports.applyCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code || subtotal === undefined) {
    return sendError(res, "Coupon code and subtotal are required", 400);
  }

  const result = await evaluateCoupon(code, subtotal);
  if (result.error) return sendError(res, result.error, 400);

  return sendSuccess(res, {
    code: result.coupon.code,
    discountAmount: result.discountAmount,
    discountPercent: result.coupon.discountPercent,
  }, "Coupon applied successfully");
});
