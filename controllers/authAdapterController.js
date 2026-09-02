const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { Customer, Account, VerificationToken } = require("../models");
const asyncHandler = require("../utils/asyncHandler");

function toAdapterUser(customer) {
  if (!customer) return null;
  const c = customer.toJSON ? customer.toJSON() : customer;
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    image: c.image,
    emailVerified: c.emailVerified,
    mobileNumber: c.mobileNumber,
    mobileVerified: c.mobileVerified,
  };
}

exports.upsertUser = asyncHandler(async (req, res) => {
  const { name, email, image, emailVerified } = req.body;
  if (!email) return res.status(400).json({ message: "email is required" });

  const normalizedEmail = String(email).toLowerCase().trim();
  let customer = await Customer.findOne({ where: { email: normalizedEmail } });

  if (!customer) {
    customer = await Customer.create({
      name: name || null,
      email: normalizedEmail,
      image: image || null,
      emailVerified: emailVerified ? new Date(emailVerified) : null,
    });
  } else {
    const patch = {};
    if (name && !customer.name) patch.name = name;
    if (image && !customer.image) patch.image = image;
    if (emailVerified !== undefined)
      patch.emailVerified = emailVerified ? new Date(emailVerified) : null;
    if (Object.keys(patch).length > 0) {
      await customer.update(patch);
    }
  }

  return res.status(200).json(toAdapterUser(customer));
});

// GET /users/:id
exports.getUserById = asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.params.id);
  if (!customer) return res.status(404).json(null);
  return res.status(200).json(toAdapterUser(customer));
});

// GET /users/by-email/:email
exports.getUserByEmail = asyncHandler(async (req, res) => {
  const email = String(req.params.email || "")
    .toLowerCase()
    .trim();
  const customer = await Customer.findOne({ where: { email } });
  if (!customer) return res.status(404).json(null);
  return res.status(200).json(toAdapterUser(customer));
});

// PATCH /users/:id
exports.updateUser = asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.params.id);
  if (!customer) return res.status(404).json(null);

  const { name, email, image, emailVerified, mobileNumber, mobileVerified } =
    req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (email !== undefined) patch.email = String(email).toLowerCase().trim();
  if (image !== undefined) patch.image = image;
  if (emailVerified !== undefined)
    patch.emailVerified = emailVerified ? new Date(emailVerified) : null;
  if (mobileNumber !== undefined) patch.mobileNumber = mobileNumber;
  if (mobileVerified !== undefined) patch.mobileVerified = mobileVerified;

  await customer.update(patch);
  return res.status(200).json(toAdapterUser(customer));
});

// GET /users/by-account?provider=&providerAccountId=
exports.getUserByAccount = asyncHandler(async (req, res) => {
  const { provider, providerAccountId } = req.query;
  if (!provider || !providerAccountId) {
    return res
      .status(400)
      .json({ message: "provider and providerAccountId are required" });
  }
  const account = await Account.findOne({
    where: { provider, providerAccountId },
  });
  if (!account) return res.status(404).json(null);
  const customer = await Customer.findByPk(account.userId);
  if (!customer) return res.status(404).json(null);
  return res.status(200).json(toAdapterUser(customer));
});

// GET /accounts/:provider/:providerAccountId
exports.getAccount = asyncHandler(async (req, res) => {
  const { provider, providerAccountId } = req.params;
  const account = await Account.findOne({
    where: { provider, providerAccountId },
  });
  if (!account) return res.status(404).json(null);
  return res.status(200).json(account.toJSON());
});

// POST /accounts — linkAccount
exports.linkAccount = asyncHandler(async (req, res) => {
  const {
    userId,
    type,
    provider,
    providerAccountId,
    refresh_token,
    access_token,
    expires_at,
    token_type,
    scope,
    id_token,
    session_state,
  } = req.body;

  if (!userId || !type || !provider || !providerAccountId) {
    return res.status(400).json({
      message: "userId, type, provider and providerAccountId are required",
    });
  }

  const account = await Account.create({
    userId,
    type,
    provider,
    providerAccountId,
    refresh_token: refresh_token || null,
    access_token: access_token || null,
    expires_at: expires_at || null,
    token_type: token_type || null,
    scope: scope || null,
    id_token: id_token || null,
    session_state: session_state || null,
  });

  // Keep Customer.googleId in sync for direct-field spec compliance.
  if (provider === "google") {
    await Customer.update(
      { googleId: providerAccountId },
      { where: { id: userId } },
    );
  }

  return res.status(200).json(account.toJSON());
});

// POST /verify-credentials — backs the "credentials" NextAuth provider
// (see sehat-potli-front's src/auth.js). `identifier` may be either the
// account's email or its verified mobile number. Always 200; the `status`
// field tells the caller (running server-side inside NextAuth's authorize())
// whether to treat this as success, wrong credentials, or an unverified
// account that needs to finish the registration OTP step.
exports.verifyCredentials = asyncHandler(async (req, res) => {
  const { identifier, authCode } = req.body;
  if (!identifier || !authCode) {
    return res.status(200).json({ status: "invalid" });
  }

  const normalizedIdentifier = String(identifier).toLowerCase().trim();
  const customer = await Customer.findOne({
    where: {
      [Op.or]: [
        { email: normalizedIdentifier },
        { mobileNumber: identifier.trim() },
      ],
    },
  });

  if (!customer || !customer.password) {
    return res.status(200).json({ status: "invalid" });
  }

  const isMatch = await bcrypt.compare(String(authCode), customer.password);
  if (!isMatch) return res.status(200).json({ status: "invalid" });

  if (!customer.emailVerified) {
    return res
      .status(200)
      .json({ status: "unverified", email: customer.email });
  }

  return res.status(200).json({ status: "ok", user: toAdapterUser(customer) });
});

// POST /verify-impersonation-token — backs the "impersonation" NextAuth
// provider (see sehat-potli-front's src/auth.js), the admin panel's "Login
// as Customer" tool. `token` is the short-lived ticket
// controllers/adminCustomerController.js impersonateCustomer just issued —
// verified here the same way any other JWT this API issues is verified,
// EXCEPT it must carry `type: "impersonation"` (a normal customer API
// token, or an admin token, must never work here). Same always-200,
// `status`-field response shape as verifyCredentials above, for the exact
// same reason (this runs inside NextAuth's authorize(), server-side).
exports.verifyImpersonationToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(200).json({ status: "invalid" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(200).json({ status: "invalid" });
  }
  if (decoded.type !== "impersonation" || !decoded.id) {
    return res.status(200).json({ status: "invalid" });
  }

  const customer = await Customer.findByPk(decoded.id);
  if (!customer) return res.status(200).json({ status: "invalid" });

  return res.status(200).json({ status: "ok", user: toAdapterUser(customer) });
});

exports.createVerificationToken = asyncHandler(async (req, res) => {
  const { identifier, token, expires } = req.body;
  if (!identifier || !token || !expires) {
    return res
      .status(400)
      .json({ message: "identifier, token and expires are required" });
  }
  const record = await VerificationToken.create({
    identifier: String(identifier).toLowerCase().trim(),
    token,
    expires: new Date(expires),
  });
  return res.status(200).json(record.toJSON());
});

// POST /verification-tokens/use — atomic delete-and-return
exports.useVerificationToken = asyncHandler(async (req, res) => {
  const { identifier, token } = req.body;
  if (!identifier || !token) {
    return res
      .status(400)
      .json({ message: "identifier and token are required" });
  }

  const normalizedIdentifier = String(identifier).toLowerCase().trim();
  const result = await VerificationToken.sequelize.transaction(async (t) => {
    const record = await VerificationToken.findOne({
      where: { identifier: normalizedIdentifier, token },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!record) return null;
    const plain = record.toJSON();
    await record.destroy({ transaction: t });
    return plain;
  });

  if (!result) return res.status(200).json(null);
  return res.status(200).json(result);
});
