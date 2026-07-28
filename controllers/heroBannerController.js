const { HeroBanner } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// GET /api/hero-banners
exports.getHeroBanners = asyncHandler(async (req, res) => {
  const banners = await HeroBanner.findAll({
    where: { status: true },
    order: [["sortOrder", "ASC"]],
  });
  return sendSuccess(res, banners);
});
