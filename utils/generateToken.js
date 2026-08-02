const jwt = require("jsonwebtoken");

function generateToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || "7d",
  });
}

module.exports = generateToken;
