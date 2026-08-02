const crypto = require("crypto");
const { sendError } = require("../utils/response");

// Guards routes that must only ever be called server-to-server by the
// Next.js frontend's NextAuth adapter — never reachable from a browser.
module.exports = function internalAuth(req, res, next) {
  const provided = req.headers["x-internal-secret"] || "";
  const expected = process.env.INTERNAL_API_SECRET || "";

  const providedBuf = Buffer.from(String(provided));
  const expectedBuf = Buffer.from(String(expected));

  const isValid =
    expected.length > 0 &&
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!isValid) return sendError(res, "Unauthorized", 401);
  next();
};
