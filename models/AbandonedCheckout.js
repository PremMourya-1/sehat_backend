const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

// A prepaid checkout attempt BEFORE payment succeeds — see
// controllers/orderController.js createOrder. Deliberately not an Order
// row: creating a real Order at checkout-initiation time (the old
// behavior) meant an order the customer never actually paid for still
// counted in the Orders list and dashboard revenue. A real Order is now
// only ever created once payment is confirmed (see
// utils/convertAbandonedCheckout.js), at which point this row is deleted —
// so a completed purchase never has both an AbandonedCheckout AND an
// Order for the same attempt.
const AbandonedCheckout = sequelize.define(
  "AbandonedCheckout",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    customerId: { type: DataTypes.UUID, allowNull: false },
    // The exact line items (variantId, productId, quantity, price, weight,
    // comboOfferId, customMixId, isFreeGift, isMixLine, ...) calculateSubtotal
    // built at checkout time — same shape utils/orderCreation.js's
    // createOrderRecord expects, so conversion just replays it directly
    // with no re-derivation.
    cartItemsSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // { shippingName, shippingPhone, alternateMobile, shippingAddress,
    //   shippingCity, shippingState, shippingPincode }
    shippingDetails: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    discountAmount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    shippingCharge: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    couponCode: { type: DataTypes.STRING, allowNull: true },
    razorpayOrderId: { type: DataTypes.STRING, allowNull: false, unique: true },
    // "pending" until either converted to a real Order (row deleted, see
    // utils/convertAbandonedCheckout.js) or "expired" — marked by
    // utils/abandonedCheckoutCleanup.js's housekeeping job once 24h have
    // passed with no successful payment. No "converted" value on purpose:
    // a converted checkout is deleted, not relabeled, so this table only
    // ever holds attempts that are still live or genuinely gave up —
    // useful for future remarketing, never a duplicate record of a real
    // order.
    status: { type: DataTypes.ENUM("pending", "expired"), defaultValue: "pending" },
    // Set only on the "payment succeeded but stock ran out in the
    // meantime" edge case (see utils/convertAbandonedCheckout.js) — the
    // row is deliberately kept (not deleted) and re-marked "expired" so
    // admin has a record of what happened and that a refund was issued,
    // instead of the payment just silently vanishing.
    failureNote: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: "AbandonedCheckouts" },
);

module.exports = AbandonedCheckout;
