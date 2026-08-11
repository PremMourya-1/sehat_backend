const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Zone-based shipping pricing — one row per zone, each owning a list of
// Indian state/UT names. utils/shippingZones.js getShippingCharge(state) is
// what actually resolves a customer's resolved state (see
// utils/pincodeResolver.js) to the right zone/charge at checkout.
const ShippingZone = sequelize.define(
  "ShippingZone",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    zoneName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // Array of Indian state/UT names, matched case-insensitively against
    // the resolved delivery state — see utils/shippingZones.js.
    states: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    shippingCharge: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "ShippingZones",
  },
);

module.exports = ShippingZone;
