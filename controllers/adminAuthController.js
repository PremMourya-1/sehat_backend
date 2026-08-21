const bcrypt = require("bcryptjs");
const { Admin } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const generateToken = require("../utils/generateToken");

const cookieOptions = { httpOnly: true, sameSite: "lax" };
const MOBILE_REGEX = /^[0-9]{10}$/;

function sanitizeAdmin(admin) {
  const a = admin.toJSON ? admin.toJSON() : admin;
  delete a.password;
  return a;
}

// POST /api/admin/login  { userName, password } — userName is email OR mobile
exports.adminLogin = asyncHandler(async (req, res) => {
  const { userName, password } = req.body;
  if (!userName || !password) return sendError(res, "Username and password are required", 400);

  const where = MOBILE_REGEX.test(userName) ? { mobile: userName } : { email: userName };
  const admin = await Admin.findOne({ where });
  if (!admin) return sendError(res, "Invalid credentials", 401);

  const isMatch = await bcrypt.compare(password, admin.password);
  if (!isMatch) return sendError(res, "Invalid credentials", 401);

  const token = generateToken({ id: admin.id, type: "admin", email: admin.email });
  res.cookie("admin_token", token, cookieOptions);

  // Cookie above is the primary mechanism (production, same-site admin
  // frontend <-> backend) — token is also returned here so the admin
  // frontend can fall back to an Authorization: Bearer header when the
  // cookie won't be sent at all, e.g. testing a local admin frontend
  // against the live backend (cross-site, SameSite=Lax withholds it). See
  // middleware/adminAuth.js, which accepts either.
  return sendSuccess(res, { ...sanitizeAdmin(admin), token }, "Login successful");
});

// POST /api/admin/logout
exports.adminLogout = asyncHandler(async (req, res) => {
  res.clearCookie("admin_token", cookieOptions);
  return sendSuccess(res, null, "Logged out successfully");
});

// PUT /api/admin/change-password
exports.adminChangePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return sendError(res, "Old and new password are required", 400);

  const admin = await Admin.findByPk(req.admin.id);
  if (!admin) return sendError(res, "Admin not found", 404);

  const isMatch = await bcrypt.compare(oldPassword, admin.password);
  if (!isMatch) return sendError(res, "Old password is incorrect", 400);

  admin.password = await bcrypt.hash(newPassword, 10);
  await admin.save();

  return sendSuccess(res, null, "Password changed successfully");
});
