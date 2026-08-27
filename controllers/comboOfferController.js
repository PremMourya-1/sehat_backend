const { ComboOffer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { comboOfferIncludes, serializeComboOffer } = require("../utils/comboOfferPresenter");

// GET /api/combo-offers/:id — public combo detail page's data source (see
// the storefront's app/combo-offers/[id]/page.js). Same "must have >= 2
// real items" guard as the homepage list (homeController.js's getHomeData)
// — never serve an incomplete/legacy combo here either, so a stray link
// can't reach a broken ₹0 combo with nothing to actually show.
exports.getComboOfferById = asyncHandler(async (req, res) => {
  const offer = await ComboOffer.findOne({
    where: { id: req.params.id, status: true },
    include: comboOfferIncludes,
  });

  if (!offer || (offer.items || []).length < 2) {
    return sendError(res, "Combo offer not found", 404);
  }

  return sendSuccess(res, serializeComboOffer(offer));
});
