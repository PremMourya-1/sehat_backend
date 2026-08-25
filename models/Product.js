const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Fixed set of allowed badge/tag values for Sehat Potli products.
const ALLOWED_TAGS = ["100% Natural", "Rich in Nutrition", "Premium Quality", "Healthy Lifestyle"];

// "Choose your base" filter tabs on the Build Your Own Mix page — a
// separate lightweight tag, not the real Category model: existing
// categories (e.g. "Single Dry Fruits") mix nuts and dried fruit together
// and don't cleanly split into nuts/seeds/dried-fruit on their own.
const ALLOWED_MIX_CATEGORIES = ["nuts", "seeds", "dried_fruit"];

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
    // Admin-toggled: only products flagged this way are selectable as
    // ingredients on the Build Your Own Mix page (see
    // controllers/mixController.js).
    isMixIngredient: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Only meaningful when isMixIngredient is true — powers the "Choose
    // your base" filter tab. Nullable: a product can be flagged as a mix
    // ingredient before its category tag is set.
    mixCategory: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isIn: {
          args: [ALLOWED_MIX_CATEGORIES],
          msg: `mixCategory must be one of: ${ALLOWED_MIX_CATEGORIES.join(", ")}`,
        },
      },
    },
  },
  {
    tableName: "Products",
  },
);

Product.ALLOWED_TAGS = ALLOWED_TAGS;
Product.ALLOWED_MIX_CATEGORIES = ALLOWED_MIX_CATEGORIES;

module.exports = Product;
