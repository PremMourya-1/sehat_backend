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
    weight: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "OrderItems",
  },
);

module.exports = OrderItem;
