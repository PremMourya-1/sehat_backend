const { Product, ProductVariant } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { getSiteSettings } = require("../utils/webSettings");
const { MAX_MIX_WEIGHT_GRAMS } = require("../utils/calculateMixPricing");

function serializeIngredient(product) {
  const p = product.toJSON ? product.toJSON() : product;
  return {
    id: p.id,
    name: p.name,
    image: p.image,
    mixCategory: p.mixCategory,
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      weight: v.weight,
      price: v.price,
      stock: v.stock,
    })),
  };
}

// GET /api/mix-ingredients — public, no auth. Everything the Build Your Own
// Mix page needs in one call: the ingredient catalog (admin-flagged via
// Product.isMixIngredient), the mix-category filter tabs, the
// admin-configurable weight increments (see utils/webSettings.js —
// Settings → General in the admin panel), and the server-enforced total
// weight cap.
exports.getMixIngredients = asyncHandler(async (req, res) => {
  const [products, settings] = await Promise.all([
    Product.findAll({
      where: { isMixIngredient: true, status: true },
      include: [{ model: ProductVariant, as: "variants", separate: true, order: [["sortOrder", "ASC"]] }],
      order: [["name", "ASC"]],
    }),
    getSiteSettings(),
  ]);

  return sendSuccess(res, {
    ingredients: products.map(serializeIngredient),
    mixCategories: Product.ALLOWED_MIX_CATEGORIES,
    weightIncrementsGrams: settings.mixWeightIncrementsGrams,
    capGrams: MAX_MIX_WEIGHT_GRAMS,
  });
});
