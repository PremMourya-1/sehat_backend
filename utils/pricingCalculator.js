// Shared price-adjustment math for the "Manage Product Pricing" admin tool
// — used by BOTH controllers/adminPricingController.js's preview and
// bulk-update endpoints (the latter never trusts a client-supplied preview,
// it recomputes via this exact same function) AND the product edit page's
// single-product quick-adjust widget, which calls the bulk-update endpoint
// with a one-item productIds array. One calculation, everywhere.
const { Product, ProductVariant, Category } = require("../models");

// Adjusts one variant's price by a fixed rupee amount or a percentage of
// its own current price, in the given direction. Rounded to paise (2dp) —
// percentage math on a DECIMAL string otherwise leaves float noise.
function computeNewPrice(oldPrice, direction, type, value) {
  const old = Number(oldPrice);
  const delta = type === "percentage" ? old * (value / 100) : value;
  const newPrice = direction === "increase" ? old + delta : old - delta;
  return Math.round(newPrice * 100) / 100;
}

// Validates the raw request params (query string for the GET preview
// endpoint, body for the POST bulk-update one — same shape either way) and
// normalizes productIds into an array. Returns { error } on any problem,
// otherwise the parsed/validated values.
function parsePricingParams({ productIds, direction, type, value }) {
  const ids = Array.isArray(productIds)
    ? productIds
    : String(productIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

  if (ids.length === 0) return { error: "At least one product must be selected" };
  if (!["increase", "decrease"].includes(direction)) {
    return { error: '"direction" must be "increase" or "decrease"' };
  }
  if (!["fixed", "percentage"].includes(type)) {
    return { error: '"type" must be "fixed" or "percentage"' };
  }
  const numValue = Number(value);
  if (!Number.isFinite(numValue) || numValue <= 0) {
    return { error: '"value" must be a positive number' };
  }

  return { ids, direction, type, value: numValue };
}

// Builds the full preview: for every requested product, the old/new price
// of each of its variants, and whether the product as a whole is excluded.
// A product is excluded in its entirety (not per-variant) the moment ANY
// one of its variants would drop to ≤0 — partially updating some of a
// product's variants while skipping others would leave it in an
// inconsistent state (e.g. 250g repriced, 1kg silently left alone).
async function buildPricingPreview(productIds, direction, type, value) {
  const products = await Product.findAll({
    where: { id: productIds },
    include: [
      { model: Category, attributes: ["name"] },
      { model: ProductVariant, as: "variants" },
    ],
  });

  const foundIds = new Set(products.map((p) => p.id));
  const notFoundIds = productIds.filter((id) => !foundIds.has(id));

  const items = products.map((product) => {
    const variants = (product.variants || []).map((variant) => {
      const oldPrice = Number(variant.price);
      const newPrice = computeNewPrice(oldPrice, direction, type, value);
      return { variantId: variant.id, weight: variant.weight, oldPrice, newPrice };
    });

    const invalidVariant = variants.find((v) => v.newPrice <= 0);

    return {
      productId: product.id,
      name: product.name,
      category: product.Category?.name || null,
      variants,
      excluded: Boolean(invalidVariant),
      exclusionReason: invalidVariant
        ? `Would drop the ${invalidVariant.weight} variant to ₹${invalidVariant.newPrice} (≤ 0)`
        : null,
    };
  });

  const includedItems = items.filter((i) => !i.excluded);
  const sumVariants = (list, key) =>
    list.reduce((sum, item) => sum + item.variants.reduce((s, v) => s + v[key], 0), 0);

  return {
    items,
    notFoundIds,
    summary: {
      totalProducts: items.length,
      includedCount: includedItems.length,
      excludedCount: items.length - includedItems.length,
      oldTotalValue: Math.round(sumVariants(includedItems, "oldPrice") * 100) / 100,
      newTotalValue: Math.round(sumVariants(includedItems, "newPrice") * 100) / 100,
    },
  };
}

module.exports = { computeNewPrice, parsePricingParams, buildPricingPreview };
