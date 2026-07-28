const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// A review can only be created after its `orderNumber` is verified against
// a real Order that contains this product — and that orderNumber can only
// ever be used once (unique), so the same proof-of-purchase code can't be
// reused to post a second review.
const ProductReview = sequelize.define(
  "ProductReview",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    productId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    orderNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 5 },
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    photo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "ProductReviews",
  },
);

module.exports = ProductReview;
