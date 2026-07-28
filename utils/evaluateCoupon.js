const { Coupon } = require("../models");

/**
 * Validates a coupon code against the current subtotal.
 * Returns { error } on failure, otherwise { coupon, discountAmount }.
 */
async function evaluateCoupon(code, subtotal) {
  if (!code) return { error: "Coupon code is required" };

  const coupon = await Coupon.findOne({ where: { code: String(code).toUpperCase() } });
  if (!coupon) return { error: "Invalid coupon code" };
  if (!coupon.isActive) return { error: "This coupon is no longer active" };
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return { error: "This coupon has expired" };
  }
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    return { error: "This coupon has reached its usage limit" };
  }
  if (Number(subtotal) < Number(coupon.minOrderAmount || 0)) {
    return { error: `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon` };
  }

  let discountAmount = (Number(subtotal) * Number(coupon.discountPercent)) / 100;
  if (coupon.maxDiscountAmount !== null && coupon.maxDiscountAmount !== undefined) {
    discountAmount = Math.min(discountAmount, Number(coupon.maxDiscountAmount));
  }
  discountAmount = Math.min(discountAmount, Number(subtotal));

  return { coupon, discountAmount: Number(discountAmount.toFixed(2)) };
}

module.exports = evaluateCoupon;
