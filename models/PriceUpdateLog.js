const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Audit trail for the "Manage Product Pricing" tool (bulk price
// increase/decrease across products) — see
// controllers/adminPricingController.js. One row per apply action, not per
// product: productIds holds every product actually updated (excluded
// products — see utils/pricingCalculator.js — are never included here).
const PriceUpdateLog = sequelize.define(
  "PriceUpdateLog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    adminId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    productIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    direction: {
      type: DataTypes.ENUM("increase", "decrease"),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("fixed", "percentage"),
      allowNull: false,
    },
    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    // Product count, not variant count — matches how the admin selects
    // ("these N products"), even though each product may carry several
    // variants under the hood.
    affectedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "PriceUpdateLogs",
    updatedAt: false,
  },
);

module.exports = PriceUpdateLog;
