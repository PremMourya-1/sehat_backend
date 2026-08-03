const { Op } = require("sequelize");
const { Notification } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/admin/notifications?date=today
// `date=today` (the only supported filter today) scopes to notifications
// created since local midnight — the admin drawer merges this with any
// live socket-received ones already sitting in its own state.
exports.getNotifications = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.date === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    where.createdAt = { [Op.gte]: startOfDay };
  }

  const notifications = await Notification.findAll({ where, order: [["createdAt", "DESC"]] });
  return sendSuccess(res, notifications);
});

// PATCH /api/admin/notifications/:id/read
exports.markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findByPk(req.params.id);
  if (!notification) return sendError(res, "Notification not found", 404);

  if (!notification.isRead) {
    notification.isRead = true;
    await notification.save();
  }

  return sendSuccess(res, notification, "Notification marked as read");
});

// PATCH /api/admin/notifications/mark-all-read
exports.markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.update({ isRead: true }, { where: { isRead: false } });
  return sendSuccess(res, null, "All notifications marked as read");
});
