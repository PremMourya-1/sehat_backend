const { ProductReview, Order, OrderItem, Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// "Firstname L." — shows a real name is behind the review (more trustworthy
// than an initials-only or fully anonymous review) without publishing a
// customer's full legal name.
function formatReviewerName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Verified Buyer";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// GET /api/products/:id/reviews?page=&limit= — public, only ever returns
// isApproved reviews. averageRating/totalReviews are computed over every
// approved review for the product, not just the current page.
exports.getReviews = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  const [{ rows, count }, approvedRatings] = await Promise.all([
    ProductReview.findAndCountAll({
      where: { productId, isApproved: true },
      include: [{ model: Customer, attributes: ["name"] }],
      order: [["createdAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    }),
    ProductReview.findAll({
      where: { productId, isApproved: true },
      attributes: ["rating"],
      raw: true,
    }),
  ]);

  const totalReviews = approvedRatings.length;
  const averageRating = totalReviews
    ? Math.round((approvedRatings.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10
    : 0;
  const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: approvedRatings.filter((r) => r.rating === star).length,
  }));

  const reviews = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    photos: r.photos,
    createdAt: r.createdAt,
    customerName: formatReviewerName(r.Customer?.name),
  }));

  return sendSuccess(res, {
    reviews,
    averageRating,
    totalReviews,
    ratingBreakdown,
    page,
    totalPages: Math.ceil(totalReviews / limit),
  });
});

// POST /api/products/:id/reviews  (customer-authenticated, multipart, up to
// 5 "photos") — { orderId, rating, comment }. Only allowed when the order is
// the customer's own, actually contains this product, and has reached
// customerStatus "delivered"; one review per (customer, product, order).
exports.createReview = asyncHandler(async (req, res) => {
  const customerId = req.customer.id;
  const productId = req.params.id;
  const { orderId, rating, comment } = req.body;

  if (!orderId) return sendError(res, "orderId is required", 400);

  const order = await Order.findOne({ where: { id: orderId, customerId } });
  if (!order) return sendError(res, "Order not found", 404);
  if (order.customerStatus !== "delivered") {
    return sendError(res, "You can only review a product once its order is delivered", 400);
  }

  const orderItem = await OrderItem.findOne({ where: { orderId, productId } });
  if (!orderItem) return sendError(res, "That order doesn't include this product", 400);

  const existing = await ProductReview.findOne({ where: { customerId, productId, orderId } });
  if (existing) return sendError(res, "You've already reviewed this product for this order", 400);

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return sendError(res, "Rating must be between 1 and 5", 400);
  }
  if (!String(comment || "").trim()) return sendError(res, "Review comment is required", 400);

  const photos = (req.files || []).map((file) => file.path);

  const review = await ProductReview.create({
    productId,
    customerId,
    orderId,
    rating: ratingNum,
    comment: comment.trim(),
    photos,
    isApproved: false,
  });

  return sendSuccess(res, review, "Review submitted — it'll show once approved", 201);
});
