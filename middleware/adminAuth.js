const jwt = require("jsonwebtoken");
const { sendError } = require("../utils/response");

module.exports = function adminAuth(req, res, next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return sendError(res, "No token provided", 401);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "admin") return sendError(res, "Forbidden", 403);
    req.admin = decoded;
    next();
  } catch (error) {
    return sendError(res, "Invalid or expired token", 401);
  }
};
