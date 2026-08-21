const bcrypt = require("bcryptjs");
const { Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const MIN_PASSWORD_LENGTH = 6;
const IS_DEV = process.env.NODE_ENV !== "production";

// GET /api/customer/security/password-status — lets the account settings
// page decide whether to show "Change Password" (current password
// required) or "Add Password" (Google-only signup, no current password to
// verify) without guessing from anything already in the session.
exports.getPasswordStatus = asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.customer.id);
  if (!customer) return sendError(res, "Account not found", 404);
  return sendSuccess(res, { hasPassword: Boolean(customer.password) });
});

// PUT /api/customer/security/password  { currentPassword?, newPassword }
// Same endpoint for both "Change" and "Add" — currentPassword is only
// required (and checked) when the account already has a password set.
// A Google-only account setting one for the first time ends up with BOTH
// login methods available afterward; nothing about the Google link is
// touched here.
exports.updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword) return sendError(res, "New password is required", 400);
  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return sendError(res, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  }

  const customer = await Customer.findByPk(req.customer.id);
  if (!customer) return sendError(res, "Account not found", 404);

  const hadPassword = Boolean(customer.password);
  if (hadPassword) {
    if (!currentPassword) {
      return sendError(res, "Current password is required", 400);
    }
    const isMatch = await bcrypt.compare(String(currentPassword), customer.password);
    if (!isMatch) return sendError(res, "Current password is incorrect", 400);
  }

  customer.password = await bcrypt.hash(newPassword, 10);
  if (IS_DEV) customer.authCode = newPassword;
  await customer.save();

  return sendSuccess(
    res,
    { hasPassword: true },
    hadPassword ? "Password updated successfully" : "Password set successfully",
  );
});
