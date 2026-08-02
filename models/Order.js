const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Order = sequelize.define(
  "Order",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    orderNumber: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    discountAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    couponCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "processing", "shipped", "delivered", "cancelled"),
      defaultValue: "pending",
    },
    shippingName: { type: DataTypes.STRING, allowNull: true },
    shippingPhone: { type: DataTypes.STRING, allowNull: true },
    shippingAddress: { type: DataTypes.STRING, allowNull: true },
    shippingCity: { type: DataTypes.STRING, allowNull: true },
    shippingState: { type: DataTypes.STRING, allowNull: true },
    shippingPincode: { type: DataTypes.STRING, allowNull: true },

    // How the order is (or will be) paid for. Defaults to "cod" since there's
    // no payment gateway wired up yet — every order today is COD. "prepaid"
    // exists for a future gateway integration to set, at which point
    // paymentStatus is what utils/shiprocket.js checks before shipping it.
    paymentMethod: {
      type: DataTypes.ENUM("cod", "prepaid"),
      defaultValue: "cod",
    },
    paymentStatus: {
      type: DataTypes.ENUM("pending", "paid", "failed"),
      defaultValue: "pending",
    },
    // Razorpay order/payment tracking for paymentMethod: "prepaid" (see
    // utils/razorpay.js). razorpayOrderId is set at order-creation time;
    // razorpayPaymentId only once payment is actually verified as paid.
    razorpayOrderId: { type: DataTypes.STRING, allowNull: true },
    razorpayPaymentId: { type: DataTypes.STRING, allowNull: true },

    // Shiprocket shipment tracking (see utils/shiprocket.js createShiprocketOrder).
    shiprocketOrderId: { type: DataTypes.STRING, allowNull: true },
    shiprocketShipmentId: { type: DataTypes.STRING, allowNull: true },
    shipmentStatus: {
      type: DataTypes.ENUM("not_created", "created", "failed"),
      defaultValue: "not_created",
    },
    shipmentCreatedAt: { type: DataTypes.DATE, allowNull: true },
    // Most recent reason a Shiprocket push was skipped or failed — cleared
    // back to null on a successful push. For debugging/admin visibility,
    // not shown to customers.
    lastShipmentError: { type: DataTypes.TEXT, allowNull: true },

    // Courier + AWB assignment (see utils/shiprocket.js assignAWBWithRetry).
    awbCode: { type: DataTypes.STRING, allowNull: true },
    courierCompanyId: { type: DataTypes.STRING, allowNull: true },
    courierName: { type: DataTypes.STRING, allowNull: true },
    awbStatus: {
      type: DataTypes.ENUM("not_assigned", "assigned", "failed"),
      defaultValue: "not_assigned",
    },
    awbAssignedAt: { type: DataTypes.DATE, allowNull: true },
    // Most recent reason AWB assignment was skipped or failed — cleared back
    // to null on a successful assignment. Debugging/admin visibility only.
    lastAwbError: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    tableName: "Orders",
  },
);

module.exports = Order;
