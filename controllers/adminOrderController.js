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

// Shared by the single and bulk status-update endpoints below, so the
// Shiprocket-trigger logic only lives in one place. An order first being
// marked "processing" — by the admin, deliberately, for both COD and
// prepaid orders — is this store's fulfillment-confirmation point; that's
// what pushes it to Shiprocket and runs the shipment -> courier -> AWB
// pipeline. fulfillOrderShipment() never throws (failures are recorded on
// the order itself), and skips the shipment push if one was already created.
async function applyOrderStatus(order, status) {
  const isNewlyProcessing = status === "processing" && order.status !== "processing";

  order.status = status;
  await order.save();

  if (isNewlyProcessing && order.shipmentStatus !== "created") {
    await fulfillOrderShipment(order.id);
    await order.reload();
  }

  return order;
}

// PUT /api/admin/orders/:id/status  { status }
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return sendError(res, `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`, 400);
  }

  const order = await Order.findByPk(req.params.id);
  if (!order) return sendError(res, "Order not found", 404);

  const updated = await applyOrderStatus(order, status);
  return sendSuccess(res, updated, "Order status updated successfully");
});

// PUT /api/admin/orders/bulk-status  { orderIds: [...], status }
// Processed sequentially (not Promise.all) — each newly-"processing" order
// makes real Shiprocket API calls, and running many of those concurrently
// risks rate-limiting/races on Shiprocket's side for what's an infrequent
// admin bulk action anyway.
exports.bulkUpdateOrderStatus = asyncHandler(async (req, res) => {
  const { orderIds, status } = req.body;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return sendError(res, "orderIds are required", 400);
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return sendError(res, `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`, 400);
  }

  const orders = await Order.findAll({ where: { id: orderIds } });
  const updated = [];
  for (const order of orders) {
    updated.push(await applyOrderStatus(order, status));
  }

  return sendSuccess(res, updated, `${updated.length} order(s) updated successfully`);
});
