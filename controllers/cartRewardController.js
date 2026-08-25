const { CartRewardTier, Product, ProductVariant } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { getSiteSettings } = require("../utils/webSettings");

function serializeTier(tier) {
  const t = tier.toJSON ? tier.toJSON() : tier;
  return {
    id: t.id,
    minCartAmount: Number(t.minCartAmount),
    giftQuantity: t.giftQuantity,
    label: t.label,
    giftProduct: t.giftProduct ? { id: t.giftProduct.id, name: t.giftProduct.name, image: t.giftProduct.image } : null,
    giftVariant: t.giftVariant ? { id: t.giftVariant.id, weight: t.giftVariant.weight } : null,
  };
}

// GET /api/cart-reward-tiers — public, no auth. Powers the storefront's cart
// fill progress bar (see calculateSubtotal.js's calculateRewardLines for how
// these same tiers turn into real free order lines at checkout — this
// endpoint is display-only, the server never trusts anything the client
// says about which reward it "earned"). A tier whose gift is entirely out of
// stock is left out here — same reasoning as /api/mix-ingredients not
// advertising an unavailable ingredient — even though the admin's own list
// (adminCartRewardController) still shows every tier regardless of stock.
exports.getPublicCartRewardTiers = asyncHandler(async (req, res) => {
  const [tiers, settings] = await Promise.all([
    CartRewardTier.findAll({
      where: { status: true },
      include: [
        { model: Product, as: "giftProduct", attributes: ["id", "name", "image"] },
        { model: ProductVariant, as: "giftVariant", attributes: ["id", "weight", "stock"] },
      ],
      order: [["minCartAmount", "ASC"]],
    }),
    getSiteSettings(),
  ]);

  const inStock = tiers.filter((tier) => tier.giftVariant && tier.giftVariant.stock > 0);

  return sendSuccess(res, {
    tiers: inStock.map(serializeTier),
    cartRewardMode: settings.cartRewardMode,
  });
});
