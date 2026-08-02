async function sendOtp(mobile, otp) {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) {
    throw new Error("2Factor is not configured — set TWOFACTOR_API_KEY");
  }

  const res = await fetch(
    `https://2factor.in/API/V1/${apiKey}/SMS/${mobile}/${otp}`,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`2Factor send failed (${res.status}): ${text}`);
  }

  return { success: true, provider: "2factor" };
}

module.exports = { sendOtp };
