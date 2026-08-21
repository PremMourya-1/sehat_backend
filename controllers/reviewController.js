const { ProductReview, Order, OrderItem } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// Verifies an order number is a genuine, product-matching, not-yet-used
// proof of purchase. Shared by both the verify-only and create endpoints so
// the create endpoint never trusts a client-side "verified" flag alone.
async function verifyOrderForProduct(orderNumberRaw, productId) {
  const orderNumber = String(orderNumberRaw || "").trim();
  if (!orderNumber) {
    return { ok: false, message: "Please enter your order number" };
  }

  const order = await Order.findOne({ where: { orderNumber } });
  if (!order) {
    return { ok: false, message: "We couldn't find an order with that number" };
  }

  const orderItem = await OrderItem.findOne({ where: { orderId: order.id, productId } });
  if (!orderItem) {
    return { ok: false, message: "That order doesn't include this product" };
  }

  const alreadyUsed = await ProductReview.findOne({ where: { orderNumber } });
  if (alreadyUsed) {
    return { ok: false, message: "This order number has already been used for a review" };
  }

  return { ok: true, orderNumber };
}

// GET /api/products/:id/reviews
exports.getReviews = asyncHandler(async (req, res) => {
  const reviews = await ProductReview.findAll({
    where: { productId: req.params.id },
    order: [["createdAt", "DESC"]],
  });
  return sendSuccess(res, reviews);
});

// POST /api/products/:id/reviews/verify  { orderNumber }
exports.verifyOrder = asyncHandler(async (req, res) => {
  const result = await verifyOrderForProduct(req.body.orderNumber, req.params.id);
  if (!result.ok) return sendError(res, result.message, 400);
  return sendSuccess(res, { verified: true }, "Order verified");
});

// POST /api/products/:id/reviews  (multipart, optional "photo")
// { orderNumber, customerName, rating, comment }
exports.createReview = asyncHandler(async (req, res) => {
  const { customerName, rating, comment } = req.body;

  const result = await verifyOrderForProduct(req.body.orderNumber, req.params.id);
  if (!result.ok) return sendError(res, result.message, 400);

  if (!String(customerName || "").trim()) return sendError(res, "Name is required", 400);
  if (!String(comment || "").trim()) return sendError(res, "Review comment is required", 400);
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return sendError(res, "Rating must be between 1 and 5", 400);
  }

  const review = await ProductReview.create({
    productId: req.params.id,
    orderNumber: result.orderNumber,
    customerName: customerName.trim(),
    rating: ratingNum,
    comment: comment.trim(),
    photo: req.file ? req.file.path : null,
  });

  return sendSuccess(res, review, "Review posted successfully", 201);
});
