const { CmsPage } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/admin/cms — list all CMS pages (no add/delete, edit-only)
exports.getAllCmsPages = asyncHandler(async (req, res) => {
  const pages = await CmsPage.findAll({ order: [["slug", "ASC"]] });
  return sendSuccess(res, pages);
});

// GET /api/admin/cms/:id
exports.getCmsPageById = asyncHandler(async (req, res) => {
  const page = await CmsPage.findByPk(req.params.id);
  if (!page) return sendError(res, "Page not found", 404);
  return sendSuccess(res, page);
});

// PUT /api/admin/cms/:id  { title, content } — edit only, no add/delete
exports.updateCmsPage = asyncHandler(async (req, res) => {
  const page = await CmsPage.findByPk(req.params.id);
  if (!page) return sendError(res, "Page not found", 404);

  const { title, content } = req.body;
  if (title !== undefined) page.title = title;
  if (content !== undefined) page.content = content;

  await page.save();
  return sendSuccess(res, page, "Page updated successfully");
});
