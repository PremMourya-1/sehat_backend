const consoleProvider = require("./console");
const msg91Provider = require("./msg91");
const twoFactorProvider = require("./twoFactor");
const whatsappProvider = require("./whatsapp");

const providers = {
  console: consoleProvider,
  msg91: msg91Provider,
  "2factor": twoFactorProvider,
  whatsapp: whatsappProvider,
};

// Swappable purely via env var — defaults to the console dev fallback
// until a real MSG91/2Factor.in account is configured.
async function sendOtp(mobile, otp) {
  const providerName = process.env.OTP_PROVIDER || "console";
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unknown OTP_PROVIDER: ${providerName}`);
  }
  return provider.sendOtp(mobile, otp);
}

module.exports = { sendOtp };
