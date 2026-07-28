const { sendError } = require("../utils/response");

module.exports = function errorHandler(err, req, res, next) {
  console.error(err);
  if (err.name === "SequelizeUniqueConstraintError") {
    return sendError(res, "A record with these details already exists", 409);
  }
  if (err.name === "SequelizeValidationError") {
    return sendError(res, err.errors?.[0]?.message || "Validation error", 400);
  }
  return sendError(res, err.message || "Internal server error", err.status || 500);
};
