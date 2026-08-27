const { ComboOfferItem, Product, ProductVariant } = require("../models");

// Shared between the homepage aggregate (controllers/homeController.js) and
// the public single-combo detail endpoint
// (controllers/comboOfferController.js), so the "what counts as a real,
// servable combo" query shape and its serialized output can't drift between
// the two.
const comboOfferIncludes = [
  {
    model: ComboOfferItem,
    as: "items",
    separate: true,
    order: [["sortOrder", "ASC"]],
    include: [
      { model: Product, attributes: ["id", "name", "image"] },
      { model: ProductVariant, as: "variant", attributes: ["id", "weight", "price", "mrp"] },
    ],
  },
];

// Adds a computed `individualTotal` (sum of each item's own variant price ×
// quantity) alongside the stored `comboPrice`, so the storefront can show
// "you save ₹X" without recomputing combo math client-side.
function serializeComboOffer(offer) {
  const plain = offer.toJSON ? offer.toJSON() : offer;
  const individualTotal = (plain.items || []).reduce(
    (sum, item) => sum + Number(item.variant?.price || 0) * item.quantity,
    0,
  );
  return { ...plain, individualTotal: Number(individualTotal.toFixed(2)) };
}

module.exports = { comboOfferIncludes, serializeComboOffer };
