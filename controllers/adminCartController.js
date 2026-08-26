const { Op } = require("sequelize");
const { Cart } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

const ABANDONED_CART_DAYS = 60;

// POST /api/admin/carts/cleanup-abandoned
// Housekeeping only, not customer-facing — this project has no
// cron/scheduled-task infrastructure yet, so this stays a manual admin
// action rather than standing up a new scheduler for one low-urgency,
// low-frequency job. Deletes Cart rows (and their CartItems, via
// onDelete: CASCADE — see models/index.js) that haven't been touched in
// 60+ days.
//
// There's no direct Cart<->Order link in this schema: checkout
// (orderController.js) clears a cart's CartItems but leaves the Cart row
// itself in place, unlinked to the order it fed. So `updatedAt` age is
// the only signal available — a cart untouched this long, whether
// genuinely abandoned mid-shop or already checked out and just never
// revisited, is safe to drop; a fresh Cart is auto-created (getOrCreateCart
// in cartController.js) the moment that customer adds anything again.
exports.cleanupAbandonedCarts = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - ABANDONED_CART_DAYS * 24 * 60 * 60 * 1000);
  const deletedCount = await Cart.destroy({ where: { updatedAt: { [Op.lt]: cutoff } } });
  return sendSuccess(res, { deletedCount }, `${deletedCount} abandoned cart(s) removed`);
});
