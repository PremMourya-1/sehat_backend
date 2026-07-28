const { Testimonial } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// GET /api/testimonials
exports.getTestimonials = asyncHandler(async (req, res) => {
  const testimonials = await Testimonial.findAll({
    where: { status: true },
    order: [["sortOrder", "ASC"]],
  });
  return sendSuccess(res, testimonials);
});
