const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// A real, purchasable product bundle — see models/ComboOfferItem.js for the
// products it contains. `status` doubles as the "is this combo active"
// flag (same boolean-toggle convention as HeroBanner/Category/etc.) rather
// than adding a separate isActive column.
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
    // The bundle's total selling price — what the customer is actually
    // charged for the combo, independent of the sum of its items' own
    // prices (that sum is computed on the fly from ComboOfferItem +
    // ProductVariant, never stored, so it can't drift out of sync).
    // defaultValue: 0 exists purely so `sync({alter:true})` can add this
    // NOT NULL column without failing on any pre-existing ComboOffer rows
    // (the old flat/no-product version of this feature had none) — every
    // real combo still requires a real price, enforced in
    // controllers/adminComboOfferController.js, not by this default.
    comboPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    discountLabel: {
      type: DataTypes.STRING,
      allowNull: true,
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
