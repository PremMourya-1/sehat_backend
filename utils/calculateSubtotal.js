const { ProductVariant } = require("../models");

/**
 * Given an array of { variantId, quantity }, look up each ProductVariant's
 * price (not the Product's — pricing lives on the variant in Sehat Potli's
 * weight-based schema) and compute the subtotal.
 *
 * Returns { error: string } if any variantId is invalid, otherwise
 * { subtotal, items: [{ variantId, productId, weight, price, quantity }] }.
 */
async function calculateSubtotal(cartItems) {
  let subtotal = 0;
  const items = [];

  for (const entry of cartItems) {
    const variant = await ProductVariant.findByPk(entry.variantId);
    if (!variant) {
      return { error: `Invalid product variant: ${entry.variantId}` };
    }
    const quantity = Number(entry.quantity) || 1;
    const price = Number(variant.price);
    subtotal += price * quantity;
    items.push({
      variantId: variant.id,
      productId: variant.productId,
      weight: variant.weight,
      price,
      quantity,
    });
  }

  return { subtotal: Number(subtotal.toFixed(2)), items };
}

module.exports = calculateSubtotal;
