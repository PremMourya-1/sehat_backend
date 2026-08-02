const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Generic credential/config store for third-party integrations (Shiprocket
// today; Razorpay or others later) — keyed by integrationKey so a new
// integration is just a new row, never a new table. Any field inside
// `config` that's a secret (password, API key, etc.) is expected to be
// encrypted before it's written here — see utils/encryption.js — since this
// is plain JSONB, not a vault.
const IntegrationSetting = sequelize.define(
  "IntegrationSetting",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    integrationKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "IntegrationSettings",
  },
);

module.exports = IntegrationSetting;
