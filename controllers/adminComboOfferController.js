const { sequelize, ComboOffer, ComboOfferItem, Product, ProductVariant } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const comboOfferIncludes = [
  {
    model: ComboOfferItem,
    as: "items",
    separate: true,
    order: [["sortOrder", "ASC"]],
    include: [
      { model: Product, attributes: ["id", "name", "image"] },
      { model: ProductVariant, as: "variant", attributes: ["id", "weight", "price", "mrp", "stock"] },
    ],
  },
];

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// Structured data (the items array) travels as a JSON-encoded string field
// on a plain JSON request body here — same parse-then-validate shape as
// adminProductController's parseVariants, just without multipart involved
// since combo offers carry no image of their own (they reuse each
// product's existing photo — see models/ComboOfferItem.js).
function parseItems(raw) {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A combo must bundle at least 2 *distinct* products (not just 2 lines —
// two variants of the same product don't count), every line needs a real
// product+variant pair belonging to each other, and a positive integer
// quantity.
async function validateItems(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return "A combo needs at least 2 products";
  }

  const distinctProductIds = new Set(items.map((i) => i.productId));
  if (distinctProductIds.size < 2) {
    return "A combo needs at least 2 distinct products";
  }

  for (const item of items) {
    if (!item.productId || !item.variantId) {
      return "Each combo item needs a product and a weight variant";
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return "Each combo item needs a positive whole-number quantity";
    }
  }

  const variantIds = items.map((i) => i.variantId);
  const variants = await ProductVariant.findAll({ where: { id: variantIds } });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  for (const item of items) {
    const variant = variantById.get(item.variantId);
    if (!variant) return `Product variant not found: ${item.variantId}`;
    if (variant.productId !== item.productId) {
      return "One of the selected weight variants doesn't belong to its product";
    }
  }

  return null;
}

// GET /api/admin/combo-offers
exports.getAllComboOffers = asyncHandler(async (req, res) => {
  const offers = await ComboOffer.findAll({
    include: comboOfferIncludes,
    order: [["sortOrder", "ASC"]],
  });
  return sendSuccess(res, offers);
});

// GET /api/admin/combo-offers/:id
exports.getComboOfferById = asyncHandler(async (req, res) => {
  const offer = await ComboOffer.findByPk(req.params.id, { include: comboOfferIncludes });
  if (!offer) return sendError(res, "Combo offer not found", 404);
  return sendSuccess(res, offer);
});

// POST /api/admin/combo-offers
exports.createComboOffer = asyncHandler(async (req, res) => {
  const { title, description, comboPrice, discountLabel, status } = req.body;
  if (!title) return sendError(res, "Title is required", 400);
  if (comboPrice === undefined || comboPrice === null || comboPrice === "" || Number(comboPrice) < 0) {
    return sendError(res, "A valid combo price is required", 400);
  }

  const items = parseItems(req.body.items);
  const itemsError = await validateItems(items);
  if (itemsError) return sendError(res, itemsError, 400);

  const maxSort = await ComboOffer.max("sortOrder");

  const offerId = await sequelize.transaction(async (t) => {
    const offer = await ComboOffer.create(
      {
        title,
        description: description || null,
        comboPrice: Number(comboPrice),
        discountLabel: discountLabel || null,
        sortOrder: (Number.isFinite(maxSort) ? maxSort : -1) + 1,
        status: toBool(status, true),
      },
      { transaction: t },
    );

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await ComboOfferItem.create(
        {
          comboOfferId: offer.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: Number(item.quantity),
          sortOrder: item.sortOrder !== undefined ? item.sortOrder : i,
        },
        { transaction: t },
      );
    }

    return offer.id;
  });

  const fullOffer = await ComboOffer.findByPk(offerId, { include: comboOfferIncludes });
  return sendSuccess(res, fullOffer, "Combo offer created successfully", 201);
});

// PUT /api/admin/combo-offers/:id
exports.updateComboOffer = asyncHandler(async (req, res) => {
  const offer = await ComboOffer.findByPk(req.params.id);
  if (!offer) return sendError(res, "Combo offer not found", 404);

  const { title, description, comboPrice, discountLabel, status, sortOrder } = req.body;

  if (comboPrice !== undefined && (comboPrice === "" || Number(comboPrice) < 0)) {
    return sendError(res, "A valid combo price is required", 400);
  }

  let items = null;
  if (req.body.items !== undefined) {
    items = parseItems(req.body.items);
    const itemsError = await validateItems(items);
    if (itemsError) return sendError(res, itemsError, 400);
  }

  await sequelize.transaction(async (t) => {
    if (title !== undefined) offer.title = title;
    if (description !== undefined) offer.description = description || null;
    if (comboPrice !== undefined) offer.comboPrice = Number(comboPrice);
    if (discountLabel !== undefined) offer.discountLabel = discountLabel || null;
    if (status !== undefined) offer.status = toBool(status, offer.status);
    if (sortOrder !== undefined) offer.sortOrder = Number(sortOrder);
    await offer.save({ transaction: t });

    if (items !== null) {
      // Sync pattern (update existing by id, create new, delete missing) —
      // same as adminProductController's variant sync.
      const existingItems = await ComboOfferItem.findAll({ where: { comboOfferId: offer.id }, transaction: t });
      const incomingIds = items.filter((i) => i.id).map((i) => i.id);

      for (const existing of existingItems) {
        if (!incomingIds.includes(existing.id)) {
          await existing.destroy({ transaction: t });
        }
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const fields = {
          productId: item.productId,
          variantId: item.variantId,
          quantity: Number(item.quantity),
          sortOrder: item.sortOrder !== undefined ? item.sortOrder : i,
        };
        if (item.id) {
          await ComboOfferItem.update(fields, { where: { id: item.id, comboOfferId: offer.id }, transaction: t });
        } else {
          await ComboOfferItem.create({ comboOfferId: offer.id, ...fields }, { transaction: t });
        }
      }
    }
  });

  const fullOffer = await ComboOffer.findByPk(offer.id, { include: comboOfferIncludes });
  return sendSuccess(res, fullOffer, "Combo offer updated successfully");
});

// DELETE /api/admin/combo-offers/:id
exports.deleteComboOffer = asyncHandler(async (req, res) => {
  const offer = await ComboOffer.findByPk(req.params.id);
  if (!offer) return sendError(res, "Combo offer not found", 404);

  await offer.destroy();
  return sendSuccess(res, null, "Combo offer deleted successfully");
});
