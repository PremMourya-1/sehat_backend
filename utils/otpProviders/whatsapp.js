const { sendOtpWhatsApp } = require("../whatsapp");

// Delivers the checkout/registration mobile OTP via WhatsApp (Meta Cloud
// API's Authentication template — see utils/whatsapp.js sendOtpWhatsApp)
// instead of SMS. Selected the same way as msg91/2factor — set
// OTP_PROVIDER=whatsapp in .env. Requires the WhatsApp integration to
// already be configured (Settings > Integrations > WhatsApp) and the
// Authentication template to be Meta-approved; sendOtpWhatsApp throws if
// either isn't ready, same as msg91's sendOtp throwing when its own env
// vars are missing — mobileVerificationController.js's sendOtp already
// treats any provider throw as a 500, no special handling needed here.
async function sendOtp(mobile, otp) {
  await sendOtpWhatsApp(mobile, otp);
  return { success: true, provider: "whatsapp" };
}

module.exports = { sendOtp };
