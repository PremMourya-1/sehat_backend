const { ShippingZone } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/admin/shipping-zones
exports.getAllShippingZones = asyncHandler(async (req, res) => {
  const zones = await ShippingZone.findAll({ order: [["createdAt", "ASC"]] });
  return sendSuccess(res, zones);
});

// POST /api/admin/shipping-zones  { zoneName, states: [...], shippingCharge }
exports.createShippingZone = asyncHandler(async (req, res) => {
  const { zoneName, states, shippingCharge } = req.body;

  if (!zoneName || shippingCharge === undefined) {
    return sendError(res, "zoneName and shippingCharge are required", 400);
  }

  const zone = await ShippingZone.create({
    zoneName,
    states: Array.isArray(states) ? states : [],
    shippingCharge,
  });

  return sendSuccess(res, zone, "Shipping zone created successfully", 201);
});

// PUT /api/admin/shipping-zones/:id
exports.updateShippingZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.findByPk(req.params.id);
  if (!zone) return sendError(res, "Shipping zone not found", 404);

  const { zoneName, states, shippingCharge } = req.body;

  if (zoneName !== undefined) zone.zoneName = zoneName;
  if (states !== undefined) zone.states = Array.isArray(states) ? states : [];
  if (shippingCharge !== undefined) zone.shippingCharge = shippingCharge;

  await zone.save();
  return sendSuccess(res, zone, "Shipping zone updated successfully");
});

// DELETE /api/admin/shipping-zones/:id
exports.deleteShippingZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.findByPk(req.params.id);
  if (!zone) return sendError(res, "Shipping zone not found", 404);

  await zone.destroy();
  return sendSuccess(res, null, "Shipping zone deleted successfully");
});
