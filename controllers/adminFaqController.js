const { Faq } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

// GET /api/admin/faqs
exports.getAllFaqs = asyncHandler(async (req, res) => {
  const faqs = await Faq.findAll({ order: [["sortOrder", "ASC"]] });
  return sendSuccess(res, faqs);
});

// POST /api/admin/faqs
exports.createFaq = asyncHandler(async (req, res) => {
  const { question, answer, status } = req.body;
  if (!question || !answer) return sendError(res, "Question and answer are required", 400);

  const maxSort = await Faq.max("sortOrder");
  const faq = await Faq.create({
    question,
    answer,
    sortOrder: (Number.isFinite(maxSort) ? maxSort : -1) + 1,
    status: toBool(status, true),
  });

  return sendSuccess(res, faq, "FAQ created successfully", 201);
});

// PUT /api/admin/faqs/:id
exports.updateFaq = asyncHandler(async (req, res) => {
  const faq = await Faq.findByPk(req.params.id);
  if (!faq) return sendError(res, "FAQ not found", 404);

  const { question, answer, status, sortOrder } = req.body;
  if (question !== undefined) faq.question = question;
  if (answer !== undefined) faq.answer = answer;
  if (status !== undefined) faq.status = toBool(status, faq.status);
  if (sortOrder !== undefined) faq.sortOrder = Number(sortOrder);

  await faq.save();
  return sendSuccess(res, faq, "FAQ updated successfully");
});

// DELETE /api/admin/faqs/:id
exports.deleteFaq = asyncHandler(async (req, res) => {
  const faq = await Faq.findByPk(req.params.id);
  if (!faq) return sendError(res, "FAQ not found", 404);

  await faq.destroy();
  return sendSuccess(res, null, "FAQ deleted successfully");
});
