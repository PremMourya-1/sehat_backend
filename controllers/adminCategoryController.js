const { Category } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { deleteUploadedImage } = require("../utils/imageStorage");

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/categories
exports.getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.findAll({ order: [["createdAt", "DESC"]] });
  return sendSuccess(res, categories);
});

// GET /api/admin/categories/:id
exports.getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return sendError(res, "Category not found", 404);
  return sendSuccess(res, category);
});

// POST /api/admin/categories
exports.createCategory = asyncHandler(async (req, res) => {
  const { name, shortDescription, status } = req.body;
  if (!name) return sendError(res, "Name is required", 400);

  const image = req.file ? req.file.path : null;
  const category = await Category.create({
    name,
    shortDescription: shortDescription || null,
    image,
    status: toBool(status, true),
  });

  return sendSuccess(res, category, "Category created successfully", 201);
});

// PUT /api/admin/categories/:id
exports.updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return sendError(res, "Category not found", 404);

  const { name, shortDescription, status } = req.body;
  if (name !== undefined) category.name = name;
  if (shortDescription !== undefined) category.shortDescription = shortDescription || null;
  if (status !== undefined) category.status = toBool(status, category.status);

  if (req.file) {
    if (category.image) await deleteUploadedImage(category.image);
    category.image = req.file.path;
  }

  await category.save();
  return sendSuccess(res, category, "Category updated successfully");
});

// DELETE /api/admin/categories/:id
exports.deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return sendError(res, "Category not found", 404);

  if (category.image) await deleteUploadedImage(category.image);
  await category.destroy();

  return sendSuccess(res, null, "Category deleted successfully");
});
