const { Category } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/categories
exports.getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.findAll({
    where: { status: true },
    order: [["name", "ASC"]],
  });
  return sendSuccess(res, categories);
});

// GET /api/categories/:id
exports.getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ where: { id: req.params.id, status: true } });
  if (!category) return sendError(res, "Category not found", 404);
  return sendSuccess(res, category);
});
