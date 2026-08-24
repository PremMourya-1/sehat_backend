const { PDFDocument } = require("pdf-lib");
const { Order, OrderItem, Product, Customer, ShiprocketWebhookLog, ComboOffer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { generateLabelAndFulfill, processStatusUpdate, cancelPickup } = require("../utils/shiprocket");
const { finalizeCancellation } = require("../utils/orderCancellation");

// Target customerStatus values the admin test simulator can drive an order
// to, mapped to one representative *raw* Shiprocket status string each —
// processStatusUpdate() runs the exact same mapShiprocketStatus() regex
// matching a real webhook payload would, so these strings are picked to
// match utils/shiprocket.js's STATUS_MAP patterns, not just be readable.
// "confirmed"/"dispatched" aren't included — those are set elsewhere
// (order creation, label generation), never by a status webhook/simulation.
const SIMULATABLE_STATUSES = {
  picked_up: "Picked Up",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  rto: "RTO Initiated",
};

// Friendly names for the "which email was triggered" note in the admin UI —
// deliberately not reusing CUSTOMER_STATUS_LABELS (that's the *status*
// label; this is the *email* name, a different vocabulary that happens to
// overlap for two of these three).
const EMAIL_LABELS = {
  "order-packed": "Order Packed",
  "out-for-delivery": "Out for Delivery",
  delivered: "Delivered",
};

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
    include: [
      { model: Product, attributes: ["id", "name", "image"] },
      { model: ComboOffer, attributes: ["id", "title"] },
    ],
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

// POST /api/admin/orders/:id/cancel  { reason }
// Admin can cancel at any stage, unlike the customer's own cancel (see
// orderController.cancelOrder), which only works while customerStatus is
// still "confirmed". If the order already has a Shiprocket shipment and
// isn't delivered yet, the shipment there is cancelled FIRST via
// cancelPickup() — utils/shiprocket.js's existing POST /orders/cancel
// wrapper, originally built (see its own comment) exactly for a future
// "cancel order" action like this one. If that fails, this returns an
// error and does NOT touch the order at all — never mark an order
// cancelled locally while the real package might still be moving.
exports.cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) {
    return sendError(res, "A cancellation reason is required", 400);
  }

  const order = await Order.findByPk(req.params.id);
  if (!order) return sendError(res, "Order not found", 404);
  if (order.customerStatus === "cancelled") {
    return sendError(res, "This order is already cancelled", 400);
  }

  if (order.shiprocketShipmentId && order.customerStatus !== "delivered") {
    const shiprocketResult = await cancelPickup(order.shiprocketShipmentId);
    if (!shiprocketResult.success) {
      return sendError(
        res,
        `Could not cancel the Shiprocket shipment (${shiprocketResult.error}) — the order was NOT cancelled. It may already be out for delivery; check Shiprocket directly before retrying.`,
        409,
      );
    }
  }

  await finalizeCancellation(order.id, {
    cancelledBy: "admin",
    cancellationReason: String(reason).trim(),
  });

  const fullOrder = await Order.findByPk(order.id, { include: orderIncludes });
  return sendSuccess(res, fullOrder, "Order cancelled successfully");
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

// POST /api/admin/orders/:id/simulate-status  { status }
//
// Internal testing tool only — see shiprocket-configuration.md "Admin Test
// Status Simulator". Drives the order through the exact same
// processStatusUpdate() the real Shiprocket webhook uses (status mapping,
// forward-only guard, email trigger) so this tests the real code path
// rather than a separate reimplementation of it — just addressed directly
// by orderId instead of resolving one from a shipment/order-id lookup, so
// it works on ANY order, including one never pushed to Shiprocket at all
// (awbCode/courierName stay null in that case, which the admin UI handles).
// Bypasses webhook signature verification entirely — that verification
// exists to authenticate an *external* caller, and this route is already
// behind adminAuth (see routes/adminRoutes.js), so it doesn't apply here.
exports.simulateStatusUpdate = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const rawStatus = SIMULATABLE_STATUSES[status];
  if (!rawStatus) {
    return sendError(res, `status must be one of: ${Object.keys(SIMULATABLE_STATUSES).join(", ")}`, 400);
  }

  const order = await Order.findByPk(req.params.id);
  if (!order) return sendError(res, "Order not found", 404);

  const result = await processStatusUpdate(order.id, rawStatus);

  // Logged the same as a real webhook event (ShiprocketWebhookLog), just
  // marked source: "admin-simulation" so it's never mistaken for a real
  // Shiprocket event in the audit trail.
  await ShiprocketWebhookLog.create({
    orderId: result.orderId,
    eventType: rawStatus,
    rawPayload: { simulated: true, targetStatus: status, triggeredByAdminId: req.admin?.id || null },
    source: "admin-simulation",
  });

  if (!result.success) {
    return sendError(res, result.error || "Could not simulate status update", 400);
  }

  const updated = await Order.findByPk(order.id, { include: orderIncludes });

  return sendSuccess(
    res,
    {
      order: updated,
      skipped: result.skipped || false,
      reason: result.reason || null,
      emailTriggered: EMAIL_LABELS[result.emailTriggered] || null,
    },
    result.skipped ? `No change — ${result.reason}` : "Status simulated successfully",
  );
});
