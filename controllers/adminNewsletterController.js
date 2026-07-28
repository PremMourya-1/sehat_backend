const { NewsletterSubscriber } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/admin/newsletter-subscribers
exports.getAllSubscribers = asyncHandler(async (req, res) => {
  const subscribers = await NewsletterSubscriber.findAll({ order: [["createdAt", "DESC"]] });
  return sendSuccess(res, subscribers);
});

// DELETE /api/admin/newsletter-subscribers/:id
exports.deleteSubscriber = asyncHandler(async (req, res) => {
  const subscriber = await NewsletterSubscriber.findByPk(req.params.id);
  if (!subscriber) return sendError(res, "Subscriber not found", 404);

  await subscriber.destroy();
  return sendSuccess(res, null, "Subscriber removed successfully");
});
