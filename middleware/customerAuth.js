const jwt = require("jsonwebtoken");
const { sendError } = require("../utils/response");

module.exports = function customerAuth(req, res, next) {
  try {
    const token = req.cookies.customer_token;
    if (!token) return sendError(res, "No token provided", 401);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.customer = decoded;
    next();
  } catch (error) {
    return sendError(res, "Invalid or expired token", 401);
  }
};
