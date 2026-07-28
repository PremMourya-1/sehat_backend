const { ComboOffer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/combo-offers
exports.getAllComboOffers = asyncHandler(async (req, res) => {
  const offers = await ComboOffer.findAll({ order: [["sortOrder", "ASC"]] });
  return sendSuccess(res, offers);
});

// POST /api/admin/combo-offers
exports.createComboOffer = asyncHandler(async (req, res) => {
  const { title, description, discountLabel, ctaLabel, ctaLink, status } = req.body;
  if (!title) return sendError(res, "Title is required", 400);

  const maxSort = await ComboOffer.max("sortOrder");
  const offer = await ComboOffer.create({
    title,
    description: description || null,
    discountLabel: discountLabel || null,
    ctaLabel: ctaLabel || "Shop Now",
    ctaLink: ctaLink || "/products",
    sortOrder: (Number.isFinite(maxSort) ? maxSort : -1) + 1,
    status: toBool(status, true),
  });

  return sendSuccess(res, offer, "Combo offer created successfully", 201);
});

// PUT /api/admin/combo-offers/:id
exports.updateComboOffer = asyncHandler(async (req, res) => {
  const offer = await ComboOffer.findByPk(req.params.id);
  if (!offer) return sendError(res, "Combo offer not found", 404);

  const { title, description, discountLabel, ctaLabel, ctaLink, status, sortOrder } = req.body;
  if (title !== undefined) offer.title = title;
  if (description !== undefined) offer.description = description || null;
  if (discountLabel !== undefined) offer.discountLabel = discountLabel || null;
  if (ctaLabel !== undefined) offer.ctaLabel = ctaLabel || "Shop Now";
  if (ctaLink !== undefined) offer.ctaLink = ctaLink || "/products";
  if (status !== undefined) offer.status = toBool(status, offer.status);
  if (sortOrder !== undefined) offer.sortOrder = Number(sortOrder);

  await offer.save();
  return sendSuccess(res, offer, "Combo offer updated successfully");
});

// DELETE /api/admin/combo-offers/:id
exports.deleteComboOffer = asyncHandler(async (req, res) => {
  const offer = await ComboOffer.findByPk(req.params.id);
  if (!offer) return sendError(res, "Combo offer not found", 404);

  await offer.destroy();
  return sendSuccess(res, null, "Combo offer deleted successfully");
});
