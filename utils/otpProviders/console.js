// Dev fallback — no real SMS account configured yet. Just logs the OTP
// server-side so the checkout flow is fully testable locally.
async function sendOtp(mobile, otp) {
  console.log(`[OTP] send ${otp} to ${mobile}`);
  return { success: true, provider: "console" };
}

module.exports = { sendOtp };
