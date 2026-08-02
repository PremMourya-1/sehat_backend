const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Auth.js Adapter "Account" table — links an external OAuth identity
// (e.g. Google) to a Customer row. One Customer can have multiple linked
// accounts (unique per provider + providerAccountId pair).
const Account = sequelize.define(
  "Account",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    provider: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    providerAccountId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    refresh_token: { type: DataTypes.TEXT, allowNull: true },
    access_token: { type: DataTypes.TEXT, allowNull: true },
    expires_at: { type: DataTypes.BIGINT, allowNull: true },
    token_type: { type: DataTypes.STRING, allowNull: true },
    scope: { type: DataTypes.STRING, allowNull: true },
    id_token: { type: DataTypes.TEXT, allowNull: true },
    session_state: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: "Accounts",
    indexes: [{ unique: true, fields: ["provider", "providerAccountId"] }],
  },
);

module.exports = Account;
