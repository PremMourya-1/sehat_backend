const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const CmsPage = sequelize.define(
  "CmsPage",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
  },
  {
    tableName: "CmsPages",
  },
);

module.exports = CmsPage;
