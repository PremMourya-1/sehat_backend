const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const OrderItem = sequelize.define(
  "OrderItem",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    // Snapshot of the variant's weight label at order time, so historical
    // orders still show e.g. "500g" even if that variant is later deleted.
    // For a Build Your Own Mix ingredient row this is the customer's chosen
    // gram amount for that ingredient (e.g. "173g"), not the variant's own
    // pack-weight label — see utils/calculateMixPricing.js.
    weight: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Groups the several ingredient rows of one Build Your Own Mix instance
    // together. Deliberately a plain UUID, not a foreign key to another
    // table — unlike a combo (an admin-authored, reusable catalog entry,
    // see comboOfferId below), a custom mix has no separate "definition"
    // that outlives this order: it's assembled fresh per purchase, so its
    // full record (which products, how many grams, what each cost) lives
    // directly on these OrderItem rows and nowhere else. Generated
    // client-side per mix instance in the cart (see
    // sehat-potli-front's cartSlice.js addMixToCart).
    customMixId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Customer-given name for the mix ("My Trail Mix"), optional —
    // duplicated onto every ingredient row of that mix rather than stored
    // once elsewhere, matching this table's existing snapshot-per-row
    // philosophy (see weight/price above).
    customMixName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // True for a free-gift line added automatically by a qualifying
    // CartRewardTier (see utils/calculateCartRewards.js) — price is always
    // 0 on these rows. A real product/variant/stock-decrement line either
    // way, unlike a mix ingredient: a reward gift is a normal shippable
    // pack, not a loose bulk ingredient.
    isFreeGift: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: "OrderItems",
  },
);

module.exports = OrderItem;
