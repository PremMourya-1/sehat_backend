const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const ComboOffer = sequelize.define(
  "ComboOffer",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    discountLabel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ctaLabel: {
      type: DataTypes.STRING,
      defaultValue: "Shop Now",
    },
    ctaLink: {
      type: DataTypes.STRING,
      defaultValue: "/products",
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
    tableName: "ComboOffers",
  },
);

module.exports = ComboOffer;
