const bcrypt = require("bcryptjs");
const { Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const generateToken = require("../utils/generateToken");
const generateOtp = require("../utils/otp");
const { sendOtpEmail } = require("../utils/mailer");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

const cookieOptions = { httpOnly: true, sameSite: "lax" };

function sanitizeCustomer(customer) {
  const c = customer.toJSON ? customer.toJSON() : customer;
  delete c.password;
  delete c.otpCode;
  delete c.otpExpiresAt;
  delete c.otpSentAt;
  return c;
}

async function issueOtp(customer) {
  const otp = generateOtp();
  const hashedOtp = await bcrypt.hash(otp, 10);
  customer.otpCode = hashedOtp;
  customer.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  customer.otpSentAt = new Date();
  await customer.save();
  await sendOtpEmail(customer.email, otp);
}

// POST /api/auth/register
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, mobile } = req.body;
  if (!email || !password || !mobile) {
    return sendError(res, "Email, password and mobile are required", 400);
  }

  const existing = await Customer.findOne({ where: { email } });
  if (existing) {
    if (existing.isVerified) {
      return sendError(res, "An account with this email already exists", 409);
    }
    // Unverified account re-registering — update details and resend OTP.
    existing.name = name || existing.name;
    existing.password = await bcrypt.hash(password, 10);
    existing.mobile = mobile;
    await issueOtp(existing);
    return sendSuccess(res, { email: existing.email }, "OTP sent to your email. Please verify to continue.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const customer = await Customer.create({ name, email, password: hashedPassword, mobile });
  await issueOtp(customer);

  return sendSuccess(res, { email: customer.email }, "Registered successfully. OTP sent to your email.", 201);
});

// POST /api/auth/verify-otp
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return sendError(res, "Email and OTP are required", 400);

  const customer = await Customer.findOne({ where: { email } });
  if (!customer) return sendError(res, "Account not found", 404);
  if (customer.isVerified) return sendError(res, "Account is already verified", 400);
  if (!customer.otpCode || !customer.otpExpiresAt) {
    return sendError(res, "No OTP request found. Please request a new OTP.", 400);
  }
  if (new Date(customer.otpExpiresAt) < new Date()) {
    return sendError(res, "OTP has expired. Please request a new one.", 400);
  }

  const isMatch = await bcrypt.compare(String(otp), customer.otpCode);
  if (!isMatch) return sendError(res, "Invalid OTP", 400);

  customer.isVerified = true;
  customer.otpCode = null;
  customer.otpExpiresAt = null;
  await customer.save();

  const token = generateToken({ id: customer.id, email: customer.email });
  res.cookie("customer_token", token, cookieOptions);

  return sendSuccess(res, sanitizeCustomer(customer), "Account verified successfully");
});

// POST /api/auth/resend-otp
exports.resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, "Email is required", 400);

  const customer = await Customer.findOne({ where: { email } });
  if (!customer) return sendError(res, "Account not found", 404);
  if (customer.isVerified) return sendError(res, "Account is already verified", 400);

  if (customer.otpSentAt) {
    const elapsed = Date.now() - new Date(customer.otpSentAt).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return sendError(res, `Please wait ${waitSeconds}s before requesting another OTP`, 429);
    }
  }

  await issueOtp(customer);
  return sendSuccess(res, { email: customer.email }, "OTP resent to your email");
});

// POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return sendError(res, "Email and password are required", 400);

  const customer = await Customer.findOne({ where: { email } });
  if (!customer) return sendError(res, "Invalid email or password", 401);

  const isMatch = await bcrypt.compare(password, customer.password);
  if (!isMatch) return sendError(res, "Invalid email or password", 401);

  if (!customer.isVerified) {
    return sendError(res, "Account not verified. Please verify your email with the OTP sent to you.", 403);
  }

  const token = generateToken({ id: customer.id, email: customer.email });
  res.cookie("customer_token", token, cookieOptions);

  return sendSuccess(res, sanitizeCustomer(customer), "Login successful");
});

// POST /api/auth/logout
exports.logout = asyncHandler(async (req, res) => {
  res.clearCookie("customer_token", cookieOptions);
  return sendSuccess(res, null, "Logged out successfully");
});

// GET /api/auth/profile
exports.profile = asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.customer.id);
  if (!customer) return sendError(res, "Account not found", 404);
  return sendSuccess(res, sanitizeCustomer(customer));
});

// PUT /api/auth/change-password
exports.changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return sendError(res, "Old and new password are required", 400);
  }

  const customer = await Customer.findByPk(req.customer.id);
  if (!customer) return sendError(res, "Account not found", 404);

  const isMatch = await bcrypt.compare(oldPassword, customer.password);
  if (!isMatch) return sendError(res, "Old password is incorrect", 400);

  customer.password = await bcrypt.hash(newPassword, 10);
  await customer.save();

  return sendSuccess(res, null, "Password changed successfully");
});
