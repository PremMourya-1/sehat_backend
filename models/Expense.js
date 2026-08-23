const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Standalone purchase/expense record — see EXPENSES.md. Deliberately has no
// association to any other model (Order/Product/etc.) and is never touched
// by the main storefront/admin flows; only routes/expensesRoutes.js and its
// own controllers ever read/write this table.
const ALLOWED_ADDED_BY = ["shinu", "komal"];

const Expense = sequelize.define(
  "Expense",
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
    purchasePrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    purchaseDate: {
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
    tableName: "Expenses",
  },
);

Expense.ALLOWED_ADDED_BY = ALLOWED_ADDED_BY;

module.exports = Expense;
