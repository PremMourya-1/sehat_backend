const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Standalone offline-sale record (a sale made outside the normal online
// store, e.g. in person) — see FINANCE.md. Same shape/isolation as
// Expense: no association to any other model, gated by the same
// expensesAuth middleware (routes/salesRoutes.js), never touched by the
// main storefront/admin flows.
const ALLOWED_ADDED_BY = ["shinu", "komal"];

const Sale = sequelize.define(
  "Sale",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    itemName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    salePrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    saleDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    addedBy: {
      type: DataTypes.ENUM(...ALLOWED_ADDED_BY),
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "Sales",
  },
);

Sale.ALLOWED_ADDED_BY = ALLOWED_ADDED_BY;

module.exports = Sale;
