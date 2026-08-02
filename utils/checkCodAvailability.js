const { Product } = require("../models");
const { getSiteSettings } = require("./webSettings");

// Whether COD can be offered for a cart/order's line items (each needing at
// least `{ productId }` — the shape calculateSubtotal() already returns).
// COD requires the site-wide toggle to be on AND every product in the
// cart to individually allow it — a single COD-disabled product in an
// otherwise-COD-able cart forces prepaid-only for the whole order (simplest
// safe rule, per product decision — no partial-COD orders).
async function getCodAvailability(lineItems) {
  const settings = await getSiteSettings();
  if (!settings.codEnabled) {
    return { available: false, reason: "Cash on Delivery is currently unavailable" };
  }

  const productIds = [...new Set(lineItems.map((item) => item.productId))];
  const products = await Product.findAll({ where: { id: productIds }, attributes: ["id", "codAvailable"] });
  const hasCodDisabledProduct = products.some((product) => product.codAvailable === false);
  if (hasCodDisabledProduct) {
    return { available: false, reason: "Cash on Delivery is not available for one or more items in your cart" };
  }

  return { available: true, reason: null };
}

module.exports = { getCodAvailability };
