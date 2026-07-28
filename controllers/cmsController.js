const { CmsPage } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/cms/:slug
exports.getCmsPageBySlug = asyncHandler(async (req, res) => {
  const page = await CmsPage.findOne({ where: { slug: req.params.slug } });
  if (!page) return sendError(res, "Page not found", 404);
  return sendSuccess(res, page);
});
