const { Order, OrderItem, Product, Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { fulfillOrderShipment } = require("../utils/shiprocket");

const ALLOWED_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];

const orderIncludes = [
  { model: Customer, attributes: ["id", "name", "email", "mobileNumber"] },
  { model: OrderItem, include: [{ model: Product, attributes: ["id", "name", "image"] }] },
];

// GET /api/admin/orders
exports.getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.findAll({
    include: orderIncludes,
    order: [["createdAt", "DESC"]],
  });
  return sendSuccess(res, orders);
});

// GET /api/admin/orders/:id
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findByPk(req.params.id, { include: orderIncludes });
  if (!order) return sendError(res, "Order not found", 404);
  return sendSuccess(res, order);
});

// PUT /api/admin/orders/:id/status  { status }
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return sendError(res, `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`, 400);
  }

  const order = await Order.findByPk(req.params.id);
  if (!order) return sendError(res, "Order not found", 404);

  const isNewlyProcessing = status === "processing" && order.status !== "processing";

  order.status = status;
  await order.save();

  // This store has no separate payment/confirmation step, so an order first
  // being marked "processing" is its confirmation point — push it to
  // Shiprocket and run the full shipment -> courier -> AWB pipeline right
  // away. fulfillOrderShipment() never throws (failures are recorded on the
  // order itself), and skips the shipment push if one was already created.
  if (isNewlyProcessing && order.shipmentStatus !== "created") {
    await fulfillOrderShipment(order.id);
    await order.reload();
  }

  return sendSuccess(res, order, "Order status updated successfully");
});
