const dns = require("dns");

const LOOKUP_TIMEOUT_MS = 5000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)),
  ]);
}

// Confirms an email's domain can actually receive mail — MX records first
// (the normal case), falling back to an A/AAAA record per RFC 5321 §5.1 (a
// domain with no MX records is still a valid mail target if it resolves at
// all; some small/legacy domains rely on this instead of publishing MX).
// Not a real-inbox check (that needs an actual send, e.g. Resend bouncing),
// just "this domain plausibly exists and can receive mail" — cheap enough
// to run before spending an OTP send on it. Fails open (treats a DNS
// timeout/resolver hiccup as valid) rather than blocking real signups over
// an infra blip on our side — the false-negative cost (annoyed legitimate
// customer) is worse than the false-positive cost (one wasted OTP).
async function isEmailDomainValid(email) {
  const domain = String(email || "").split("@")[1];
  if (!domain) return false;

  try {
    const mxRecords = await withTimeout(dns.promises.resolveMx(domain));
    if (mxRecords === null) return true; // timed out — fail open
    if (mxRecords.length > 0) return true;
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") return true; // unexpected error — fail open
  }

  try {
    const addresses = await withTimeout(
      Promise.all([
        dns.promises.resolve4(domain).catch(() => []),
        dns.promises.resolve6(domain).catch(() => []),
      ]).then(([a, aaaa]) => [...a, ...aaaa]),
    );
    if (addresses === null) return true; // timed out — fail open
    return addresses.length > 0;
  } catch {
    return false;
  }
}

module.exports = { isEmailDomainValid };
