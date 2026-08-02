const bcrypt = require("bcryptjs");
const { Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const generateOtp = require("../utils/otp");
const otpProviders = require("../utils/otpProviders");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

// POST /api/customer/mobile/send-otp
exports.sendOtp = asyncHandler(async (req, res) => {
  const { mobileNumber } = req.body;
  if (!mobileNumber || !/^[0-9]{10}$/.test(mobileNumber)) {
    return sendError(res, "A valid 10-digit mobile number is required", 400);
  }

  const customer = await Customer.findByPk(req.customer.id);
  if (!customer) return sendError(res, "Account not found", 404);

  if (customer.mobileOtpSentAt) {
    const elapsed = Date.now() - new Date(customer.mobileOtpSentAt).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return sendError(res, `Please wait ${waitSeconds}s before requesting another OTP`, 429);
    }
  }

  const otp = generateOtp();
  customer.mobileOtpCode = await bcrypt.hash(otp, 10);
  customer.mobileOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  customer.mobileOtpSentAt = new Date();
  // Record the pending number now so verify-otp below can't be tricked
  // into confirming a different number than the one the OTP was sent to.
  customer.mobileNumber = mobileNumber;
  customer.mobileVerified = false;
  await customer.save();

  await otpProviders.sendOtp(mobileNumber, otp);

  return sendSuccess(res, { mobileNumber }, "OTP sent to your mobile number");
});

// POST /api/customer/mobile/verify-otp
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, otp } = req.body;
  if (!mobileNumber || !otp) {
    return sendError(res, "Mobile number and OTP are required", 400);
  }

  const customer = await Customer.findByPk(req.customer.id);
  if (!customer) return sendError(res, "Account not found", 404);

  if (!customer.mobileOtpCode || !customer.mobileOtpExpiresAt) {
    return sendError(res, "No OTP request found. Please request a new OTP.", 400);
  }
  if (customer.mobileNumber !== mobileNumber) {
    return sendError(res, "This OTP was sent to a different mobile number", 400);
  }
  if (new Date(customer.mobileOtpExpiresAt) < new Date()) {
    return sendError(res, "OTP has expired. Please request a new one.", 400);
  }

  const isMatch = await bcrypt.compare(String(otp), customer.mobileOtpCode);
  if (!isMatch) return sendError(res, "Invalid OTP", 400);

  customer.mobileVerified = true;
  customer.mobileOtpCode = null;
  customer.mobileOtpExpiresAt = null;
  customer.mobileOtpSentAt = null;
  await customer.save();

  return sendSuccess(res, {
    mobileNumber: customer.mobileNumber,
    mobileVerified: customer.mobileVerified,
  }, "Mobile number verified successfully");
});
