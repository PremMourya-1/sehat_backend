const jwt = require("jsonwebtoken");
const { sendError } = require("../utils/response");

// Completely separate from middleware/adminAuth.js — its own JWT secret
// (EXPENSES_JWT_SECRET, never the admin/customer JWT_SECRET), its own
// Authorization-header-only flow (no cookie), and only ever mounted on
// /api/expenses/* routes (see routes/expensesRoutes.js). A token signed for
// the admin panel will not verify here, and vice versa.
module.exports = function expensesAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return sendError(res, "No token provided", 401);

    const decoded = jwt.verify(token, process.env.EXPENSES_JWT_SECRET);
    if (decoded.type !== "expenses") return sendError(res, "Forbidden", 403);

    req.expenseUser = { name: decoded.name };
    next();
  } catch (error) {
    return sendError(res, "Invalid or expired token", 401);
  }
};
