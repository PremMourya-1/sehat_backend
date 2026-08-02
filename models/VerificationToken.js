const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Auth.js Adapter "VerificationToken" table — stores the hashed,
// single-use magic-link token issued by the Email provider until it's
// redeemed (or expires).
const VerificationToken = sequelize.define(
  "VerificationToken",
  {
    identifier: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    token: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expires: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    tableName: "VerificationTokens",
    timestamps: false,
    indexes: [{ unique: true, fields: ["identifier", "token"] }],
  },
);

module.exports = VerificationToken;
