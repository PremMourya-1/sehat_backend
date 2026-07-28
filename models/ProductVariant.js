const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Fixed set of allowed weight options for a product variant.
const ALLOWED_WEIGHTS = ["250g", "500g", "1kg"];

const ProductVariant = sequelize.define(
  "ProductVariant",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    weight: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [ALLOWED_WEIGHTS],
      },
    },
    mrp: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    stock: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    tableName: "ProductVariants",
  },
);

ProductVariant.ALLOWED_WEIGHTS = ALLOWED_WEIGHTS;

module.exports = ProductVariant;
