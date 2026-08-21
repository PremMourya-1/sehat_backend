const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Raw audit trail of every Shiprocket status webhook received (see
// controllers/webhookController.js shiprocketWebhook and utils/shiprocket.js
// handleShiprocketStatusWebhook) — one row per request, written before any
// processing/mapping happens, so a status that doesn't update as expected
// can be debugged from the DB instead of digging through server logs.
const ShiprocketWebhookLog = sequelize.define(
  "ShiprocketWebhookLog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Nullable — a webhook payload we can't match to a known order (unknown
    // shipment/order id) is still logged, just without this set.
    orderId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Shiprocket's raw `current_status` string, unmodified — see
    // utils/shiprocket.js mapShiprocketStatus() for how this gets
    // translated into our customerStatus values.
    eventType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    rawPayload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    // "webhook" = a real Shiprocket status webhook. "admin-simulation" = the
    // admin panel's test tool (adminOrderController.simulateStatusUpdate)
    // calling the exact same processStatusUpdate() logic directly, for
    // testing without a real courier — kept distinguishable here so the
    // audit log never confuses a manually-triggered test event for a real
    // one from Shiprocket.
    source: {
      type: DataTypes.ENUM("webhook", "admin-simulation"),
      allowNull: false,
      defaultValue: "webhook",
    },
    receivedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "ShiprocketWebhookLogs",
    updatedAt: false,
  },
);

module.exports = ShiprocketWebhookLog;
