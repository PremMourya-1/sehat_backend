async function sendOtp(mobile, otp) {
  const apiKey = process.env.MSG91_API_KEY;
  const senderId = process.env.MSG91_SENDER_ID;
  if (!apiKey || !senderId) {
    throw new Error("MSG91 is not configured — set MSG91_API_KEY and MSG91_SENDER_ID");
  }

  const res = await fetch("https://control.msg91.com/api/v5/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: apiKey },
    body: JSON.stringify({ mobile: `91${mobile}`, otp, sender: senderId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MSG91 send failed (${res.status}): ${text}`);
  }

  return { success: true, provider: "msg91" };
}

module.exports = { sendOtp };
