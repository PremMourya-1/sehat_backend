const { CartRewardTier, Product, ProductVariant } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const tierIncludes = [
  { model: Product, as: "giftProduct", attributes: ["id", "name", "image"] },
  { model: ProductVariant, as: "giftVariant", attributes: ["id", "weight", "price", "stock"] },
];

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

async function validateGift(giftProductId, giftVariantId) {
  if (!giftProductId || !giftVariantId) {
    return "A gift product and weight variant are required";
  }
  const variant = await ProductVariant.findByPk(giftVariantId);
  if (!variant) return "Gift variant not found";
  if (variant.productId !== giftProductId) {
    return "The selected weight variant doesn't belong to the selected product";
  }
  return null;
}

// GET /api/admin/cart-rewards
exports.getAllCartRewardTiers = asyncHandler(async (req, res) => {
  const tiers = await CartRewardTier.findAll({
    include: tierIncludes,
    order: [
      ["sortOrder", "ASC"],
      ["minCartAmount", "ASC"],
    ],
  });
  return sendSuccess(res, tiers);
});

// GET /api/admin/cart-rewards/:id
exports.getCartRewardTierById = asyncHandler(async (req, res) => {
  const tier = await CartRewardTier.findByPk(req.params.id, { include: tierIncludes });
  if (!tier) return sendError(res, "Cart reward tier not found", 404);
  return sendSuccess(res, tier);
});

// POST /api/admin/cart-rewards
// body: { minCartAmount, giftProductId, giftVariantId, giftQuantity?, label?, status? }
exports.createCartRewardTier = asyncHandler(async (req, res) => {
  const { minCartAmount, giftProductId, giftVariantId, giftQuantity, label, status } = req.body;

  if (minCartAmount === undefined || minCartAmount === null || minCartAmount === "" || Number(minCartAmount) <= 0) {
    return sendError(res, "A valid minimum cart amount is required", 400);
  }
  const giftError = await validateGift(giftProductId, giftVariantId);
  if (giftError) return sendError(res, giftError, 400);
  if (giftQuantity !== undefined && (!Number.isInteger(Number(giftQuantity)) || Number(giftQuantity) < 1)) {
    return sendError(res, "Gift quantity must be a positive whole number", 400);
  }

  const maxSort = await CartRewardTier.max("sortOrder");

  const tier = await CartRewardTier.create({
    minCartAmount: Number(minCartAmount),
    giftProductId,
    giftVariantId,
    giftQuantity: giftQuantity !== undefined ? Number(giftQuantity) : 1,
    label: label || null,
    sortOrder: (Number.isFinite(maxSort) ? maxSort : -1) + 1,
    status: toBool(status, true),
  });

  const fullTier = await CartRewardTier.findByPk(tier.id, { include: tierIncludes });
  return sendSuccess(res, fullTier, "Cart reward tier created successfully", 201);
});

// PUT /api/admin/cart-rewards/:id
exports.updateCartRewardTier = asyncHandler(async (req, res) => {
  const tier = await CartRewardTier.findByPk(req.params.id);
  if (!tier) return sendError(res, "Cart reward tier not found", 404);

  const { minCartAmount, giftProductId, giftVariantId, giftQuantity, label, status, sortOrder } = req.body;

  if (minCartAmount !== undefined && (minCartAmount === "" || Number(minCartAmount) <= 0)) {
    return sendError(res, "A valid minimum cart amount is required", 400);
  }
  if (giftProductId !== undefined || giftVariantId !== undefined) {
    const giftError = await validateGift(
      giftProductId !== undefined ? giftProductId : tier.giftProductId,
      giftVariantId !== undefined ? giftVariantId : tier.giftVariantId,
    );
    if (giftError) return sendError(res, giftError, 400);
  }
  if (giftQuantity !== undefined && (!Number.isInteger(Number(giftQuantity)) || Number(giftQuantity) < 1)) {
    return sendError(res, "Gift quantity must be a positive whole number", 400);
  }

  if (minCartAmount !== undefined) tier.minCartAmount = Number(minCartAmount);
  if (giftProductId !== undefined) tier.giftProductId = giftProductId;
  if (giftVariantId !== undefined) tier.giftVariantId = giftVariantId;
  if (giftQuantity !== undefined) tier.giftQuantity = Number(giftQuantity);
  if (label !== undefined) tier.label = label || null;
  if (status !== undefined) tier.status = toBool(status, tier.status);
  if (sortOrder !== undefined) tier.sortOrder = Number(sortOrder);
  await tier.save();

  const fullTier = await CartRewardTier.findByPk(tier.id, { include: tierIncludes });
  return sendSuccess(res, fullTier, "Cart reward tier updated successfully");
});

// DELETE /api/admin/cart-rewards/:id
exports.deleteCartRewardTier = asyncHandler(async (req, res) => {
  const tier = await CartRewardTier.findByPk(req.params.id);
  if (!tier) return sendError(res, "Cart reward tier not found", 404);

  await tier.destroy();
  return sendSuccess(res, null, "Cart reward tier deleted successfully");
});
