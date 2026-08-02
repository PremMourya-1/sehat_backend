const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// Site-wide business settings (COD toggle today; maintenanceMode,
// minOrderValue, etc. later) — one key/value JSONB row per settingKey, same
// shape as IntegrationSetting but its own model/table since this is site
// configuration, not third-party integration credentials. Adding a new
// setting later is just a new key inside `value`, never a new table.
const WebSetting = sequelize.define(
  "WebSetting",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    settingKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "WebSettings",
  },
);

module.exports = WebSetting;
