const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Order = sequelize.define(
  "Order",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    orderNumber: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    discountAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    couponCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "processing", "shipped", "delivered", "cancelled"),
      defaultValue: "pending",
    },
    shippingName: { type: DataTypes.STRING, allowNull: true },
    shippingPhone: { type: DataTypes.STRING, allowNull: true },
    shippingAddress: { type: DataTypes.STRING, allowNull: true },
    shippingCity: { type: DataTypes.STRING, allowNull: true },
    shippingState: { type: DataTypes.STRING, allowNull: true },
    shippingPincode: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: "Orders",
  },
);

module.exports = Order;
