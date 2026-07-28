const { Coupon } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/coupons
exports.getAllCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.findAll({ order: [["createdAt", "DESC"]] });
  return sendSuccess(res, coupons);
});

// GET /api/admin/coupons/:id
exports.getCouponById = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (!coupon) return sendError(res, "Coupon not found", 404);
  return sendSuccess(res, coupon);
});

// POST /api/admin/coupons
exports.createCoupon = asyncHandler(async (req, res) => {
  const { code, discountPercent, minOrderAmount, maxDiscountAmount, usageLimit, expiresAt, isActive } = req.body;

  if (!code || discountPercent === undefined) {
    return sendError(res, "Code and discountPercent are required", 400);
  }

  const coupon = await Coupon.create({
    code,
    discountPercent,
    minOrderAmount: minOrderAmount || 0,
    maxDiscountAmount: maxDiscountAmount || null,
    usageLimit: usageLimit || null,
    expiresAt: expiresAt || null,
    isActive: toBool(isActive, true),
  });

  return sendSuccess(res, coupon, "Coupon created successfully", 201);
});

// PUT /api/admin/coupons/:id
exports.updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (!coupon) return sendError(res, "Coupon not found", 404);

  const { code, discountPercent, minOrderAmount, maxDiscountAmount, usageLimit, expiresAt, isActive } = req.body;

  if (code !== undefined) coupon.code = code;
  if (discountPercent !== undefined) coupon.discountPercent = discountPercent;
  if (minOrderAmount !== undefined) coupon.minOrderAmount = minOrderAmount;
  if (maxDiscountAmount !== undefined) coupon.maxDiscountAmount = maxDiscountAmount || null;
  if (usageLimit !== undefined) coupon.usageLimit = usageLimit || null;
  if (expiresAt !== undefined) coupon.expiresAt = expiresAt || null;
  if (isActive !== undefined) coupon.isActive = toBool(isActive, coupon.isActive);

  await coupon.save();
  return sendSuccess(res, coupon, "Coupon updated successfully");
});

// DELETE /api/admin/coupons/:id
exports.deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (!coupon) return sendError(res, "Coupon not found", 404);

  await coupon.destroy();
  return sendSuccess(res, null, "Coupon deleted successfully");
});
