const bcrypt = require("bcryptjs");
const { Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const generateToken = require("../utils/generateToken");
const generateOtp = require("../utils/otp");
const { sendOtpEmail } = require("../utils/mailer");

const cookieOptions = { httpOnly: true, sameSite: "lax" };

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const IS_DEV = process.env.NODE_ENV !== "production";

async function issueRegistrationOtp(customer) {
  const otp = generateOtp();
  customer.emailOtpCode = await bcrypt.hash(otp, 10);
  customer.emailOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  customer.emailOtpSentAt = new Date();
  await customer.save();
  await sendOtpEmail(customer.email, otp);
}

// POST /api/auth/register — {name, email, password}. Creates an unverified
// Customer and emails a 6-digit OTP; the account only becomes usable once
// verify-otp succeeds (the frontend then auto-logs the user in).
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return sendError(res, "Name, email and password are required", 400);
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const hashedPassword = await bcrypt.hash(password, 10);

  let customer = await Customer.findOne({ where: { email: normalizedEmail } });
  if (customer) {
    if (customer.emailVerified) {
      return sendError(res, "An account with this email already exists", 409);
    }
    // Unverified account re-registering — update details and resend OTP.
    customer.name = name;
    customer.password = hashedPassword;
    if (IS_DEV) customer.authCode = password;
    await issueRegistrationOtp(customer);
    return sendSuccess(res, { email: customer.email }, "OTP sent to your email. Please verify to continue.");
  }

  customer = await Customer.create({
    name,
    email: normalizedEmail,
    password: hashedPassword,
    authCode: IS_DEV ? password : null,
  });
  await issueRegistrationOtp(customer);

  return sendSuccess(res, { email: customer.email }, "Registered successfully. OTP sent to your email.", 201);
});

// POST /api/auth/register/verify-otp — {email, otp}
exports.verifyRegistrationOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return sendError(res, "Email and OTP are required", 400);

  const normalizedEmail = String(email).toLowerCase().trim();
  const customer = await Customer.findOne({ where: { email: normalizedEmail } });
  if (!customer) return sendError(res, "Account not found", 404);
  if (customer.emailVerified) return sendError(res, "Account is already verified", 400);
  if (!customer.emailOtpCode || !customer.emailOtpExpiresAt) {
    return sendError(res, "No OTP request found. Please request a new OTP.", 400);
  }
  if (new Date(customer.emailOtpExpiresAt) < new Date()) {
    return sendError(res, "OTP has expired. Please request a new one.", 400);
  }

  const isMatch = await bcrypt.compare(String(otp), customer.emailOtpCode);
  if (!isMatch) return sendError(res, "Invalid OTP", 400);

  customer.emailVerified = new Date();
  customer.emailOtpCode = null;
  customer.emailOtpExpiresAt = null;
  customer.emailOtpSentAt = null;
  await customer.save();

  return sendSuccess(res, { email: customer.email }, "Account verified successfully");
});

// POST /api/auth/register/resend-otp — {email}
exports.resendRegistrationOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, "Email is required", 400);

  const normalizedEmail = String(email).toLowerCase().trim();
  const customer = await Customer.findOne({ where: { email: normalizedEmail } });
  if (!customer) return sendError(res, "Account not found", 404);
  if (customer.emailVerified) return sendError(res, "Account is already verified", 400);

  if (customer.emailOtpSentAt) {
    const elapsed = Date.now() - new Date(customer.emailOtpSentAt).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return sendError(res, `Please wait ${waitSeconds}s before requesting another OTP`, 429);
    }
  }

  await issueRegistrationOtp(customer);
  return sendSuccess(res, { email: customer.email }, "OTP resent to your email");
});

// POST /api/auth/logout — kept so any lingering legacy cookie gets cleared.
// NextAuth owns sign-in/sign-out on the frontend now; there is no server
// session to invalidate here beyond this cookie.
exports.logout = asyncHandler(async (req, res) => {
  res.clearCookie("customer_token", cookieOptions);
  return sendSuccess(res, null, "Logged out successfully");
});

// POST /api/auth/internal/issue-token — internal-only. Called from the
// Next.js NextAuth `jwt` callback right after the Auth.js adapter resolves
// (or creates) a Customer, so the frontend can talk to this API's
// customerAuth-protected routes (cart/orders) via a short-lived Bearer token.
exports.issueInternalToken = asyncHandler(async (req, res) => {
  const { customerId } = req.body;
  if (!customerId) return sendError(res, "customerId is required", 400);

  const customer = await Customer.findByPk(customerId);
  if (!customer) return sendError(res, "Customer not found", 404);

  const token = generateToken({ id: customer.id }, "30m");
  return sendSuccess(res, { token, expiresInSeconds: 30 * 60 });
});
