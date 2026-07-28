const { Faq } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// GET /api/faqs
exports.getFaqs = asyncHandler(async (req, res) => {
  const faqs = await Faq.findAll({
    where: { status: true },
    order: [["sortOrder", "ASC"]],
  });
  return sendSuccess(res, faqs);
});
