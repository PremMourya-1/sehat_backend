const { ProductReview, Customer, Product, Order } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/admin/reviews?status=pending|approved|all (default: all)
exports.getAllReviews = asyncHandler(async (req, res) => {
  const status = req.query.status || "all";
  const where = {};
  if (status === "pending") where.isApproved = false;
  else if (status === "approved") where.isApproved = true;

  const reviews = await ProductReview.findAll({
    where,
    include: [
      { model: Customer, attributes: ["name", "email"] },
      { model: Product, attributes: ["name", "image"] },
      { model: Order, attributes: ["orderNumber"] },
    ],
    order: [["createdAt", "DESC"]],
  });

  return sendSuccess(res, reviews);
});

// PUT /api/admin/reviews/:id/approve
exports.approveReview = asyncHandler(async (req, res) => {
  const review = await ProductReview.findByPk(req.params.id);
  if (!review) return sendError(res, "Review not found", 404);

  review.isApproved = true;
  await review.save();
  return sendSuccess(res, review, "Review approved");
});

// DELETE /api/admin/reviews/:id — used for both rejecting a still-pending
// review and removing an already-approved one; there's no separate
// "rejected" state, a rejected review is simply gone.
exports.deleteReview = asyncHandler(async (req, res) => {
  const review = await ProductReview.findByPk(req.params.id);
  if (!review) return sendError(res, "Review not found", 404);

  await review.destroy();
  return sendSuccess(res, null, "Review deleted");
});
