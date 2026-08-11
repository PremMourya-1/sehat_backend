const { PDFDocument } = require("pdf-lib");
const { Order, OrderItem, Product, Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { generateLabelAndFulfill } = require("../utils/shiprocket");

const ALLOWED_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

const orderIncludes = [
  { model: Customer, attributes: ["id", "name", "email", "mobileNumber"] },
  {
    model: OrderItem,
    include: [{ model: Product, attributes: ["id", "name", "image"] }],
  },
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

// Shared by the single and bulk status-update endpoints below. Just updates
// the admin's operational status now — Shiprocket fulfillment is no longer
// tied to any status transition, it only ever runs from the explicit
// "Generate Label" admin action (see generateLabel below).
async function applyOrderStatus(order, status) {
  order.status = status;
  await order.save();
  return order;
}

// PUT /api/admin/orders/:id/status  { status }
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return sendError(
      res,
      `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
      400,
    );
  }

  const order = await Order.findByPk(req.params.id);
  if (!order) return sendError(res, "Order not found", 404);

  const updated = await applyOrderStatus(order, status);
  return sendSuccess(res, updated, "Order status updated successfully");
});

// PUT /api/admin/orders/bulk-status  { orderIds: [...], status }
// Processed sequentially (not Promise.all) — kept that way even though this
// no longer triggers Shiprocket, so behavior for a large orderIds batch
// stays predictable/ordered.
exports.bulkUpdateOrderStatus = asyncHandler(async (req, res) => {
  const { orderIds, status } = req.body;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return sendError(res, "orderIds are required", 400);
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return sendError(
      res,
      `Status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
      400,
    );
  }

  const orders = await Order.findAll({ where: { id: orderIds } });
  const updated = [];
  for (const order of orders) {
    updated.push(await applyOrderStatus(order, status));
  }

  return sendSuccess(
    res,
    updated,
    `${updated.length} order(s) updated successfully`,
  );
});

exports.generateLabel = asyncHandler(async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return sendError(res, "Order not found", 404);

  const result = await generateLabelAndFulfill(order.id);
  if (!result.success) {
    return sendError(res, result.error || "Label generation failed", 400);
  }

  const updated = await Order.findByPk(order.id, { include: orderIncludes });
  return sendSuccess(res, updated, "Label generated successfully");
});

// POST /api/admin/orders/download-labels  { orderIds: [...] }
// Merges every requested order's Shiprocket-hosted label PDF into a single
// downloadable PDF — much more useful for bulk printing than a zip of
// separate files. The admin frontend already filters orderIds down to
// labelStatus === "generated" before calling this (same client-side skip
// pattern as bulk Generate Label), but this re-filters server-side too —
// never trust that alone. A single label that fails to fetch/parse is
// logged and skipped rather than failing the whole merge; only an empty
// result (nothing could be merged) is a hard error.
exports.downloadLabels = asyncHandler(async (req, res) => {
  const { orderIds } = req.body;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return sendError(res, "orderIds are required", 400);
  }

  const orders = await Order.findAll({
    where: { id: orderIds, labelStatus: "generated" },
  });
  if (orders.length === 0) {
    return sendError(res, "None of the selected orders have a generated label", 400);
  }

  const mergedPdf = await PDFDocument.create();
  const failed = [];

  for (const order of orders) {
    try {
      if (!order.labelUrl) throw new Error("No label URL on record");
      const response = await fetch(order.labelUrl);
      if (!response.ok) throw new Error(`Failed to fetch label (${response.status})`);

      const bytes = await response.arrayBuffer();
      const labelPdf = await PDFDocument.load(bytes);
      const copiedPages = await mergedPdf.copyPages(labelPdf, labelPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } catch (err) {
      console.error(`Failed to merge label for order ${order.orderNumber}: ${err.message}`);
      failed.push(order.orderNumber);
    }
  }

  if (mergedPdf.getPageCount() === 0) {
    return sendError(res, "Could not fetch any of the selected labels", 502);
  }

  const mergedBytes = await mergedPdf.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="shipping-labels-${Date.now()}.pdf"`);
  // Visibility for the frontend toast (see orderService.js downloadOrderLabels)
  // without needing to parse the PDF body itself for a merge count.
  res.setHeader("X-Labels-Merged", String(orders.length - failed.length));
  res.setHeader("X-Labels-Failed", String(failed.length));
  return res.send(Buffer.from(mergedBytes));
});
