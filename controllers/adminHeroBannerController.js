const { HeroBanner } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { deleteUploadedImage } = require("../utils/imageStorage");

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/hero-banners
exports.getAllHeroBanners = asyncHandler(async (req, res) => {
  const banners = await HeroBanner.findAll({ order: [["sortOrder", "ASC"]] });
  return sendSuccess(res, banners);
});

// POST /api/admin/hero-banners  (multipart, single "image")
exports.createHeroBanner = asyncHandler(async (req, res) => {
  if (!req.file) return sendError(res, "Banner image is required", 400);

  const maxSort = await HeroBanner.max("sortOrder");
  const banner = await HeroBanner.create({
    image: req.file.path,
    title: req.body.title || null,
    description: req.body.description || null,
    sortOrder: (Number.isFinite(maxSort) ? maxSort : -1) + 1,
    status: toBool(req.body.status, true),
  });

  return sendSuccess(res, banner, "Hero banner created successfully", 201);
});

// PUT /api/admin/hero-banners/:id
exports.updateHeroBanner = asyncHandler(async (req, res) => {
  const banner = await HeroBanner.findByPk(req.params.id);
  if (!banner) return sendError(res, "Hero banner not found", 404);

  if (req.body.status !== undefined) banner.status = toBool(req.body.status, banner.status);
  if (req.body.sortOrder !== undefined) banner.sortOrder = Number(req.body.sortOrder);
  if (req.body.title !== undefined) banner.title = req.body.title || null;
  if (req.body.description !== undefined) banner.description = req.body.description || null;

  if (req.file) {
    await deleteUploadedImage(banner.image);
    banner.image = req.file.path;
  }

  await banner.save();
  return sendSuccess(res, banner, "Hero banner updated successfully");
});

// DELETE /api/admin/hero-banners/:id
exports.deleteHeroBanner = asyncHandler(async (req, res) => {
  const banner = await HeroBanner.findByPk(req.params.id);
  if (!banner) return sendError(res, "Hero banner not found", 404);

  await deleteUploadedImage(banner.image);
  await banner.destroy();

  return sendSuccess(res, null, "Hero banner deleted successfully");
});
