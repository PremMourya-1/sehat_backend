const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// One real product+variant line inside a ComboOffer. comboOfferId,
// productId, variantId are added via associations in models/index.js (same
// convention as OrderItem/CartItem) — not declared inline here.
const ComboOfferItem = sequelize.define(
  "ComboOfferItem",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    tableName: "ComboOfferItems",
  },
);

module.exports = ComboOfferItem;
