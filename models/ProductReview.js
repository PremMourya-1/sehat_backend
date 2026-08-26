const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// A review can only be created by a logged-in customer for a product in one
// of their own orders once that order's customerStatus is "delivered" (see
// controllers/reviewController.js createReview) — customerId/orderId are
// nullable at the DB level only so `sync({alter:true})` doesn't choke on any
// pre-existing rows from the old order-number-verification design this
// replaced; every review created through the current flow always has both
// set. The (customerId, productId, orderId) unique index is what actually
// enforces "one review per customer per product per order".
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
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: true,
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
    photos: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
    },
    // Moderation gate — false until an admin approves it (Admin panel →
    // Reviews). Only approved reviews are ever returned by the public
    // GET /api/products/:id/reviews.
    isApproved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "ProductReviews",
    indexes: [{ unique: true, fields: ["customerId", "productId", "orderId"] }],
  },
);

module.exports = ProductReview;
