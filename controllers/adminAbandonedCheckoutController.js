const { AbandonedCheckout, Customer, Product } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// GET /api/admin/abandoned-checkouts — read-only, informational (see
// models/AbandonedCheckout.js). Captures exactly what a future remarketing
// feature would need (customer contact info + what they were trying to
// buy) but doesn't act on any of it itself.
//
// cartItemsSnapshot only stores productId/variantId/quantity/price/weight
// (see utils/calculateSubtotal.js's line-item shape) — no product name, so
// this batch-resolves names/images for every distinct productId across all
// returned checkouts in one query, rather than a live association (JSONB
// content can't be `include`d the way a real FK column can).
exports.getAllAbandonedCheckouts = asyncHandler(async (req, res) => {
  const checkouts = await AbandonedCheckout.findAll({
    include: [{ model: Customer, attributes: ["id", "name", "email"] }],
    order: [["createdAt", "DESC"]],
  });

  const productIds = new Set();
  checkouts.forEach((c) => (c.cartItemsSnapshot || []).forEach((line) => line.productId && productIds.add(line.productId)));

  const products = productIds.size
    ? await Product.findAll({ where: { id: [...productIds] }, attributes: ["id", "name", "image"] })
    : [];
  const productMap = new Map(products.map((p) => [p.id, { name: p.name, image: p.image }]));

  const withResolvedItems = checkouts.map((c) => {
    const plain = c.toJSON();
    plain.cartItemsSnapshot = (plain.cartItemsSnapshot || []).map((line) => ({
      ...line,
      productName: productMap.get(line.productId)?.name || line.customMixName || "Product",
      productImage: productMap.get(line.productId)?.image || null,
    }));
    return plain;
  });

  return sendSuccess(res, withResolvedItems);
});
