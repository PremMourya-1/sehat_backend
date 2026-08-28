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
    // Zone-based charge resolved from the delivery state at order-creation
    // time (see utils/shippingZones.js getShippingCharge) — stored here
    // (not just shown on the frontend) so it's part of the actual amount
    // charged/collected: total = subtotal - discountAmount + shippingCharge.
    shippingCharge: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "processing", "shipped", "delivered", "cancelled"),
      defaultValue: "pending",
    },
    // Customer-facing status — deliberately separate from the admin's
    // operational `status` above. "dispatched" is set automatically the
    // moment label generation succeeds (see utils/shiprocket.js
    // generateLabelAndFulfill). picked_up/in_transit/out_for_delivery/
    // delivered/rto are driven by Shiprocket's status webhook from here on
    // (see utils/shiprocket.js handleShiprocketStatusWebhook) — "rto" covers
    // every Return-to-Origin sub-status Shiprocket sends (RTO Initiated,
    // RTO Delivered, RTO Acknowledged, ...), not tracked as separate values.
    // "cancelled" is a terminal branch like "rto" — see
    // utils/orderCancellation.js and isForwardProgress() in
    // utils/shiprocket.js, which blocks any further status change once set.
    //
    // "payment_pending" / "payment_failed" are LEGACY values, kept only for
    // backward compatibility with historical rows — no order is ever
    // created at either value anymore. They briefly existed for a design
    // where a prepaid order was created up front and sat at
    // "payment_pending" until paid; that's since been replaced by a
    // stronger approach where NO Order is created at all until payment
    // actually succeeds (see models/AbandonedCheckout.js and
    // utils/convertAbandonedCheckout.js) — an unpaid checkout attempt now
    // never touches this table, so it can never be miscounted as a real
    // order anywhere (Orders list, dashboard revenue, ...). COD still goes
    // straight to "confirmed" at creation, same as always — it never had a
    // payment-uncertainty window to begin with.
    customerStatus: {
      type: DataTypes.ENUM(
        "payment_pending",
        "payment_failed",
        "confirmed",
        "dispatched",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "rto",
        "cancelled",
      ),
      defaultValue: "confirmed",
    },
    // One timestamp per customerStatus value ever reached, keyed by that
    // same status string (e.g. { confirmed: <date>, dispatched: <date>,
    // picked_up: <date>, ... }) — set once each webhook/action first moves
    // the order into that stage (see orderController.createOrder,
    // utils/shiprocket.js generateLabelAndFulfill/processStatusUpdate) and
    // never overwritten afterward, so the tracking stepper can show "reached
    // <date>" per step instead of only the current stage.
    statusHistory: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
    // Cancellation — see utils/orderCancellation.js finalizeCancellation(),
    // called from both the customer-initiated (orderController.cancelOrder,
    // only while customerStatus === "confirmed") and admin-initiated
    // (adminOrderController.cancelOrder, any status) cancel endpoints.
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledBy: { type: DataTypes.ENUM("customer", "admin"), allowNull: true },
    cancellationReason: { type: DataTypes.TEXT, allowNull: true },
    // Refund tracking for prepaid+paid orders that get cancelled (see
    // utils/razorpay.js createRefund) — stays "not_applicable" for every COD
    // order and every prepaid order that was never actually paid (nothing
    // to refund in either case).
    refundStatus: {
      type: DataTypes.ENUM("not_applicable", "pending", "completed", "failed"),
      defaultValue: "not_applicable",
    },
    refundedAt: { type: DataTypes.DATE, allowNull: true },
    refundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    shippingName: { type: DataTypes.STRING, allowNull: true },
    shippingPhone: { type: DataTypes.STRING, allowNull: true },
    // Optional second contact number for delivery — e.g. a family member's
    // number in case the primary shippingPhone is unreachable. Plain text,
    // no OTP verification (same as shippingPhone) — see mobileVerification-
    // Required in utils/webSettings.js for the separate, account-level
    // OTP-verified Customer.mobileNumber.
    alternateMobile: { type: DataTypes.STRING, allowNull: true, validate: { is: /^[0-9]{10}$/ } },
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
    // Set alongside awbCode/courierName from the assigned courier's own
    // estimate (see utils/shiprocket.js getCourierEstimatedDeliveryDate) —
    // null until AWB assignment succeeds, so the tracking page has nothing
    // to show before dispatch.
    estimatedDeliveryDate: { type: DataTypes.DATE, allowNull: true },
    // The REAL amount Shiprocket charges/deducts from the wallet for this
    // shipment — the selected courier's own rate at AWB-assignment time (see
    // utils/shiprocket.js assignAWB/getCourierRate). Deliberately separate
    // from shippingCharge above, which is the flat ShippingZone rate charged
    // to the CUSTOMER — the two are unrelated numbers; comparing them is
    // exactly how the admin sees actual margin per order. Null until AWB
    // assignment succeeds, same lifecycle as estimatedDeliveryDate.
    shippingCostActual: { type: DataTypes.DECIMAL(10, 2), allowNull: true },

    // Pickup scheduling (see utils/shiprocket.js schedulePickup/cancelPickup).
    pickupStatus: {
      type: DataTypes.ENUM("not_scheduled", "scheduled", "failed", "cancelled"),
      defaultValue: "not_scheduled",
    },
    // When we asked Shiprocket to schedule the pickup (our own timestamp).
    pickupScheduledAt: { type: DataTypes.DATE, allowNull: true },
    // The pickup date Shiprocket itself confirms/expects, from its response.
    pickupDate: { type: DataTypes.DATE, allowNull: true },
    // Most recent reason pickup scheduling failed — cleared back to null on
    // a successful schedule. Debugging/admin visibility only.
    lastPickupError: { type: DataTypes.TEXT, allowNull: true },

    // Shipping label (see utils/shiprocket.js generateLabel). Requires AWB
    // already assigned — generated as part of the admin's explicit
    // "Generate Label" action, not any automatic status transition.
    labelStatus: {
      type: DataTypes.ENUM("not_generated", "generated", "failed"),
      defaultValue: "not_generated",
    },
    labelUrl: { type: DataTypes.STRING, allowNull: true },
    labelGeneratedAt: { type: DataTypes.DATE, allowNull: true },
    // Most recent reason label generation failed — cleared back to null on
    // a successful generation. Debugging/admin visibility only.
    lastLabelError: { type: DataTypes.TEXT, allowNull: true },

    // Tracks which transactional emails (see utils/email.js) have already
    // been sent for this order, so a retry/duplicate trigger — including
    // the future webhook phase reusing these same trigger points — never
    // double-sends. outForDelivery/delivered aren't wired to anything yet
    // (that's the future webhook phase) but the flags exist now so that
    // phase doesn't need another migration.
    emailsSent: {
      type: DataTypes.JSONB,
      defaultValue: { confirmed: false, packed: false, outForDelivery: false, delivered: false, cancelled: false },
    },

    // Same flag-guarded-idempotency purpose as emailsSent above, for the
    // WhatsApp order-status template messages (see utils/whatsapp.js
    // sendOrderConfirmedWhatsApp/sendOrderDispatchedWhatsApp/
    // sendOrderDeliveredWhatsApp) — a separate JSONB rather than reusing
    // emailsSent since the two channels can fail/succeed independently (e.g.
    // WhatsApp template not yet approved) and each needs its own send record.
    // Only 3 keys, not 5 like emailsSent — no WhatsApp template exists for
    // outForDelivery/cancelled (see whatsapp_integration_architecture memory
    // for why: only order_confirmed/order_dispatched/order_delivered were
    // requested). "dispatched" here fires at the same trigger point as
    // emailsSent.packed (label generation / pickup-scan webhook) — named
    // "dispatched" instead of "packed" to match the WhatsApp template's own
    // name (order_dispatched), not because it's a different event.
    whatsappSent: {
      type: DataTypes.JSONB,
      defaultValue: { confirmed: false, dispatched: false, delivered: false },
    },

    // Snapshotted once at creation time from WebSettings' notificationChannel
    // (see utils/webSettings.js, utils/orderCreation.js createOrderRecord) —
    // never changed after that, so an order keeps notifying via whichever
    // channel was active site-wide when it was placed, even if the admin
    // flips the setting later. Nullable/no defaultValue on purpose: existing
    // rows created before this field existed read back null, which
    // utils/notifications.js treats as "email" (what they actually used).
    notificationChannel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "Orders",
  },
);

module.exports = Order;
