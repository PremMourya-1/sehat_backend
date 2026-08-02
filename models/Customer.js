const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Customer = sequelize.define(
  "Customer",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    googleId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Bcrypt-hashed login password — this is what's actually checked by the
    // "credentials" NextAuth provider (email/mobile + password login).
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Dev-only convenience: the plaintext password, kept alongside the hash
    // above purely so it's readable in the DB while testing multiple
    // accounts locally. Only ever populated when NODE_ENV !== "production"
    // (see controllers/authController.js) — never rely on this outside dev.
    authCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Set once the registration email-OTP is verified. Login is blocked
    // until this is non-null.
    emailVerified: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    emailOtpCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    emailOtpExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    emailOtpSentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    mobileNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: { is: /^[0-9]{10}$/ },
    },
    mobileVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    mobileOtpCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    mobileOtpExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    mobileOtpSentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "Customers",
  },
);

module.exports = Customer;
