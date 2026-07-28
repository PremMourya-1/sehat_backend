const { Resend } = require("resend");

// Constructed lazily (not at module-load time) so that simply requiring this
// file never throws — e.g. before dotenv has loaded, or in environments
// where RESEND_API_KEY is intentionally left unset until OTP email is
// actually needed.
let resendClient = null;
function getResendClient() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendOtpEmail(to, otp) {
  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const html = `
    <div style="font-family: Poppins, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #F5EDE0; border-radius: 12px;">
      <h2 style="color: #2E4A3B; font-family: 'Playfair Display', serif; margin-bottom: 4px;">Sehat Potli</h2>
      <p style="color: #5C4033; font-style: italic; margin-top: 0;">Sehat Ki Potli, Har Ghar Ki Zaroorat</p>
      <p style="color: #2A2A28; font-size: 15px;">Use the OTP below to verify your Sehat Potli account:</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #6B1F2A; background: #ffffff; padding: 14px 0; text-align: center; border-radius: 8px; margin: 16px 0;">
        ${otp}
      </div>
      <p style="color: #2A2A28; font-size: 13px;">This OTP is valid for 10 minutes. If you did not request this, please ignore this email.</p>
      <p style="color: #C89B3C; font-size: 13px; margin-top: 24px;">Team Sehat Potli — Pure. Natural. Wholesome.</p>
    </div>
  `;

  await getResendClient().emails.send({
    from: fromEmail,
    to,
    subject: "Your Sehat Potli verification code",
    html,
  });
}

module.exports = { sendOtpEmail };
