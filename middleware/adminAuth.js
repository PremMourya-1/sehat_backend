const jwt = require("jsonwebtoken");
const { sendError } = require("../utils/response");

// Cookie first (production, same-site — admin frontend and backend share a
// registrable domain) — falling back to an Authorization: Bearer header
// when there's no cookie at all, e.g. a local admin frontend testing
// against the live backend. SameSite=Lax cookies are never sent cross-site,
// but the login response also returns the token in its body for exactly
// this case (see controllers/adminAuthController.js adminLogin). Token
// validation itself is unchanged either way.
module.exports = function adminAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = req.cookies.admin_token || bearerToken;
    if (!token) return sendError(res, "No token provided", 401);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "admin") return sendError(res, "Forbidden", 403);
    req.admin = decoded;
    next();
  } catch (error) {
    return sendError(res, "Invalid or expired token", 401);
  }
};
