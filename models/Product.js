const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Fixed set of allowed badge/tag values for Sehat Potli products.
const ALLOWED_TAGS = ["100% Natural", "Rich in Nutrition", "Premium Quality", "Healthy Lifestyle"];

const Product = sequelize.define(
  "Product",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    shortDescription: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    longDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    showOnHome: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isTrending: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Per-product COD override — final COD availability at checkout also
    // depends on the site-wide toggle (see utils/webSettings.js) and courier
    // COD serviceability for the delivery pincode.
    codAvailable: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    // Per-100g nutrition facts: { calories, protein, fat, carbs, fiber }.
    // Admin-entered, per-product — null until the admin fills it in (no
    // fake/placeholder values are ever shown on the storefront).
    nutrition: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    // Ingredient breakdown for mixes/combos: [{ ingredient, percentage }].
    composition: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
      validate: {
        isAllowedTags(value) {
          if (!Array.isArray(value)) return;
          const invalid = value.filter((tag) => !ALLOWED_TAGS.includes(tag));
          if (invalid.length) {
            throw new Error(`Invalid tag(s): ${invalid.join(", ")}`);
          }
        },
      },
    },
  },
  {
    tableName: "Products",
  },
);

Product.ALLOWED_TAGS = ALLOWED_TAGS;

module.exports = Product;
