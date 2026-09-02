const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Audit trail for the admin "Login as Customer" tool (see
// controllers/adminCustomerController.js impersonateCustomer) — one row per
// impersonation action, written unconditionally before the ticket is even
// issued, so any customer-reported "someone accessed my account" concern is
// traceable to exactly which admin, which customer, and when. This table is
// a record only — nothing here restricts or expires access after the fact.
const ImpersonationLog = sequelize.define(
  "ImpersonationLog",
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
    customerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: "ImpersonationLogs",
    updatedAt: false,
  },
);

module.exports = ImpersonationLog;
