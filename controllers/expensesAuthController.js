const jwt = require("jsonwebtoken");
const { IntegrationSetting, Expense } = require("../models");
const { encrypt, decrypt } = require("../utils/encryption");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const ALLOWED_ADDED_BY = Expense.ALLOWED_ADDED_BY;

const INTEGRATION_KEY = "expenses";
const TOKEN_EXPIRES_IN = "30d";

// Same DB-first, .env-fallback-seed pattern as utils/shiprocket.js
// getCredentials() — lets the shared password be changed later straight
// from the DB (no redeploy needed) while still supporting a zero-config
// first run via EXPENSES_PASSWORD. See FINANCE.md for how to change it.
async function getExpensesPassword() {
  const setting = await IntegrationSetting.findOne({
    where: { integrationKey: INTEGRATION_KEY },
  });

  if (setting?.config?.password) {
    return decrypt(setting.config.password);
  }

  const envPassword = process.env.EXPENSES_PASSWORD;
  if (!envPassword) {
    throw new Error(
      "Expenses password is not configured — set EXPENSES_PASSWORD in .env for first-time setup",
    );
  }

  const seededConfig = { password: encrypt(envPassword) };
  if (setting) {
    setting.config = seededConfig;
    await setting.save();
  } else {
    await IntegrationSetting.create({
      integrationKey: INTEGRATION_KEY,
      config: seededConfig,
    });
  }
  console.log("Expenses password seeded into IntegrationSettings from .env");

  return envPassword;
}

// POST /api/expenses/login  { name, password } — no auth required (this IS
// the auth endpoint). Issues a token signed with EXPENSES_JWT_SECRET, a
// different secret from the admin panel's JWT_SECRET (see
// middleware/expensesAuth.js) — an admin session and an expenses session
// are never interchangeable.
exports.expensesLogin = asyncHandler(async (req, res) => {
  const { name, password } = req.body;

  if (!ALLOWED_ADDED_BY.includes(name)) {
    return sendError(res, `Name must be one of: ${ALLOWED_ADDED_BY.join(", ")}`, 400);
  }
  if (!password) {
    return sendError(res, "Password is required", 400);
  }

  let expectedPassword;
  try {
    expectedPassword = await getExpensesPassword();
  } catch (err) {
    return sendError(res, err.message, 500);
  }

  if (password !== expectedPassword) {
    return sendError(res, "Incorrect password", 401);
  }

  const token = jwt.sign({ name, type: "expenses" }, process.env.EXPENSES_JWT_SECRET, {
    expiresIn: TOKEN_EXPIRES_IN,
  });

  return sendSuccess(res, { token, name }, "Login successful");
});
