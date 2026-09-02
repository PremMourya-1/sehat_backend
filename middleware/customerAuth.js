const jwt = require("jsonwebtoken");
const { sendError } = require("../utils/response");

module.exports = function customerAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const token = bearerToken || req.cookies.customer_token;
    if (!token) return sendError(res, "No token provided", 401);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Impersonation tickets (see controllers/adminCustomerController.js
    // impersonateCustomer) are single-purpose, meant only to be exchanged
    // once via /api/auth/adapter/verify-impersonation-token for a real
    // customer session — never valid as a Bearer token against ordinary
    // customer-facing routes like this one.
    if (decoded.type === "impersonation") return sendError(res, "Invalid or expired token", 401);
    req.customer = decoded;
    next();
  } catch (error) {
    return sendError(res, "Invalid or expired token", 401);
  }
};
