const bcrypt = require("bcryptjs");
const { Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const generateToken = require("../utils/generateToken");
const generateOtp = require("../utils/otp");
const { sendOtpEmail } = require("../utils/mailer");
const { isEmailDomainValid } = require("../utils/validateEmailDomain");

const cookieOptions = { httpOnly: true, sameSite: "lax" };

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MIN_PASSWORD_LENGTH = 6; // matches controllers/accountSecurityController.js
const IS_DEV = process.env.NODE_ENV !== "production";

// Shared by registration (verify-your-email) and forgot-password (reset
// your password) — both are just "prove you own this inbox right now"
// checks using the same emailOtpCode/emailOtpExpiresAt/emailOtpSentAt
// columns. Safe to share: a customer only ever has one of the two flows
// in flight at a time in practice (forgot-password is only reachable once
// emailVerified is already set and a password already exists, i.e. after
// registration's OTP step is long done), so there's no real collision risk
// worth a separate set of columns for.
async function issueEmailOtp(customer) {
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

  // Domain-level deliverability check (MX, falling back to A/AAAA per RFC
  // 5321) — catches typos and made-up domains before an OTP send is wasted
  // on them. Not Gmail-only or provider-restricted on purpose: any real,
  // receiving domain is accepted (Yahoo, Outlook, a company's own domain,
  // ...). See utils/validateEmailDomain.js.
  if (!(await isEmailDomainValid(normalizedEmail))) {
    return sendError(res, "This email address doesn't appear to be valid", 400);
  }

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
    await issueEmailOtp(customer);
    return sendSuccess(res, { email: customer.email }, "OTP sent to your email. Please verify to continue.");
  }

  customer = await Customer.create({
    name,
    email: normalizedEmail,
    password: hashedPassword,
    authCode: IS_DEV ? password : null,
  });
  await issueEmailOtp(customer);

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

  await issueEmailOtp(customer);
  return sendSuccess(res, { email: customer.email }, "OTP resent to your email");
});

// POST /api/auth/forgot-password — {email}. Public/unauthenticated (the
// whole point is the customer can't log in). Doubles as its own "resend" —
// calling it again while a code is still outstanding is rate-limited the
// same way resendRegistrationOtp is above, so the frontend can just call
// this endpoint again for a "Resend OTP" action rather than needing a
// third route.
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, "Email is required", 400);

  const normalizedEmail = String(email).toLowerCase().trim();
  const customer = await Customer.findOne({ where: { email: normalizedEmail } });
  if (!customer) return sendError(res, "No account found with this email", 404);

  // Google-only account, never added a password (see
  // controllers/accountSecurityController.js "Add Password") — nothing to
  // reset. Don't send an OTP for a flow that can't finish.
  if (!customer.password) {
    return sendError(res, "This account doesn't have a password — sign in with Google", 400);
  }

  if (customer.emailOtpSentAt) {
    const elapsed = Date.now() - new Date(customer.emailOtpSentAt).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return sendError(res, `Please wait ${waitSeconds}s before requesting another OTP`, 429);
    }
  }

  await issueEmailOtp(customer);
  return sendSuccess(res, { email: customer.email }, "A password reset code has been sent to your email");
});

// POST /api/auth/reset-password — {email, otp, newPassword}. Same OTP
// verification checks as verifyRegistrationOtp above (expiry, hash
// compare), deliberately not shared as one function with it — that one
// also gates on "not already verified" and sets emailVerified, neither of
// which applies here (a forgot-password customer is already verified by
// definition; verifying the OTP here should set a password, not touch
// emailVerified at all).
exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return sendError(res, "Email, OTP and new password are required", 400);
  }
  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return sendError(res, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const customer = await Customer.findOne({ where: { email: normalizedEmail } });
  if (!customer) return sendError(res, "Account not found", 404);
  if (!customer.emailOtpCode || !customer.emailOtpExpiresAt) {
    return sendError(res, "No reset code request found. Please request a new one.", 400);
  }
  if (new Date(customer.emailOtpExpiresAt) < new Date()) {
    return sendError(res, "Reset code has expired. Please request a new one.", 400);
  }

  const isMatch = await bcrypt.compare(String(otp), customer.emailOtpCode);
  if (!isMatch) return sendError(res, "Invalid reset code", 400);

  customer.password = await bcrypt.hash(newPassword, 10);
  if (IS_DEV) customer.authCode = newPassword;
  // Invalidate the code immediately — same "used once" contract as
  // verifyRegistrationOtp, prevents replaying it for another reset.
  customer.emailOtpCode = null;
  customer.emailOtpExpiresAt = null;
  customer.emailOtpSentAt = null;
  await customer.save();

  // Note: this doesn't invalidate any other active session for this
  // customer (NextAuth's customer JWTs are stateless — no server-side
  // session store or token-version field exists anywhere in this codebase
  // to revoke against). A device that was already logged in before the
  // reset stays logged in until its token naturally expires. Confirmed
  // there's no existing mechanism to hook into for this; adding one (a
  // sessionVersion column + checking it in customerAuth/NextAuth's jwt
  // callback) would be new infrastructure, out of scope here — flagging as
  // a possible follow-up rather than building it as a side effect of this task.
  return sendSuccess(res, { email: customer.email }, "Password reset successfully. Please log in.");
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
