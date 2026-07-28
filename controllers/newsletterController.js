const { NewsletterSubscriber } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/newsletter/subscribe  { email }
exports.subscribe = asyncHandler(async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    return sendError(res, "Please enter a valid email address", 400);
  }

  const [, created] = await NewsletterSubscriber.findOrCreate({ where: { email } });
  if (!created) {
    return sendSuccess(res, null, "You're already subscribed!");
  }

  return sendSuccess(res, null, "Subscribed successfully!", 201);
});
