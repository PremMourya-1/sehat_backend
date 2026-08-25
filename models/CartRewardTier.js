const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// "Spend ₹X, get a free gift" tiers — admin-authored, real reusable catalog
// entities (like ComboOffer/HeroBanner), not per-order like a custom mix.
// See utils/calculateCartRewards.js for how qualifying tiers turn into
// free OrderItem lines at checkout. giftProductId/giftVariantId are added
// via association in models/index.js, not declared inline here.
const CartRewardTier = sequelize.define(
  "CartRewardTier",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Cart subtotal (before this tier's own reward, which is always ₹0
    // anyway) the customer must reach to unlock this tier's gift.
    minCartAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    giftQuantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    // Admin-written celebratory copy, e.g. "Free Mix Seeds 250g!" — shown
    // on the storefront's cart progress bar. Falls back to a generated
    // "Free {product name}" if left blank.
    label: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "CartRewardTiers",
  },
);

module.exports = CartRewardTier;
