const { Product, ProductVariant } = require("../models");
const { parseWeightToKg } = require("./shiprocket");

const MAX_MIX_WEIGHT_GRAMS = 1000;

// A mix ingredient's per-gram rate is derived from its *smallest* variant's
// price ÷ weight — not an arbitrary/admin-picked variant, and not averaged
// across variants (larger packs are usually bulk-discounted, so a 1kg
// variant's ₹/g is not the same as a 500g variant's — using the smallest
// pack keeps the rate closest to a true per-unit price). Reuses
// utils/shiprocket.js's parseWeightToKg so "250g"/"1kg" parsing is never
// duplicated.
function pickReferenceVariant(variants) {
  const withGrams = variants
    .map((v) => ({ variant: v, grams: parseWeightToKg(v.weight) * 1000 }))
    .filter((v) => v.grams > 0);
  if (withGrams.length === 0) return null;
  withGrams.sort((a, b) => a.grams - b.grams);
  return withGrams[0];
}

/**
 * Validates and prices one submitted custom mix. The customer never picks a
 * pack-size variant in the mix builder — only grams — so `variantId` is
 * deliberately not part of the input shape; the reference variant used for
 * pricing/stock-gating is always resolved server-side via
 * pickReferenceVariant, never trusted from the client.
 *
 * @param {{ id: string, name?: string, items: { productId: string, grams: number }[] }} mix
 * @returns {Promise<{ error: string } | { id, name, totalWeightGrams, totalPrice, items: { productId, variantId, grams, price, weight }[] }>}
 */
async function priceCustomMix(mix) {
  if (!mix || !Array.isArray(mix.items) || mix.items.length === 0) {
    return { error: "A custom mix needs at least one ingredient" };
  }

  const totalWeightGrams = mix.items.reduce((sum, item) => sum + (Number(item.grams) || 0), 0);
  if (totalWeightGrams <= 0) {
    return { error: "A custom mix needs a non-zero total weight" };
  }
  if (totalWeightGrams > MAX_MIX_WEIGHT_GRAMS) {
    return { error: `A custom mix can't exceed ${MAX_MIX_WEIGHT_GRAMS}g total` };
  }

  const productIds = [...new Set(mix.items.map((i) => i.productId))];
  const products = await Product.findAll({
    where: { id: productIds },
    include: [{ model: ProductVariant, as: "variants" }],
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const items = [];
  let totalPrice = 0;

  for (const entry of mix.items) {
    const grams = Number(entry.grams);
    if (!Number.isFinite(grams) || grams <= 0) {
      return { error: "Each ingredient needs a positive gram amount" };
    }

    const product = productById.get(entry.productId);
    if (!product) return { error: `Ingredient product not found: ${entry.productId}` };
    if (!product.isMixIngredient) {
      return { error: `"${product.name}" is not available as a mix ingredient` };
    }

    const reference = pickReferenceVariant(product.variants || []);
    if (!reference) return { error: `"${product.name}" has no valid weight variant to price from` };

    // Gate-only stock check (no fractional/gram-based decrement — see
    // controllers/orderController.js comment on the stock-decrement loop):
    // an ingredient with zero pack stock on its reference variant is
    // treated as unavailable, full stop, rather than trying to reduce it by
    // a gram-equivalent amount that has no clean relationship to a
    // whole-pack counter.
    if (Number(reference.variant.stock) <= 0) {
      return { error: `"${product.name}" is currently out of stock` };
    }

    const perGramRate = Number(reference.variant.price) / reference.grams;
    const price = Number((perGramRate * grams).toFixed(2));

    items.push({
      productId: product.id,
      variantId: reference.variant.id,
      grams,
      price,
      weight: `${grams}g`,
    });
    totalPrice += price;
  }

  return {
    id: mix.id,
    name: mix.name ? String(mix.name).trim().slice(0, 100) : null,
    totalWeightGrams,
    totalPrice: Number(totalPrice.toFixed(2)),
    items,
  };
}

module.exports = { priceCustomMix, MAX_MIX_WEIGHT_GRAMS };
