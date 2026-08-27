const { sequelize, ProductVariant, PriceUpdateLog } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { parsePricingParams, buildPricingPreview } = require("../utils/pricingCalculator");

// GET /api/admin/pricing/preview?productIds=a,b,c&direction=increase&type=percentage&value=10
// Read-only — never writes anything. The bulk-update endpoint below
// recomputes this exact same preview server-side before applying, rather
// than trusting whatever the client last previewed.
exports.previewPricing = asyncHandler(async (req, res) => {
  const parsed = parsePricingParams(req.query);
  if (parsed.error) return sendError(res, parsed.error, 400);

  const preview = await buildPricingPreview(parsed.ids, parsed.direction, parsed.type, parsed.value);
  return sendSuccess(res, preview);
});

// POST /api/admin/pricing/bulk-update  { productIds, direction, type, value }
// Also the single-product quick-adjust widget's endpoint (see
// Pages/Product/ProductForm.jsx) — it just calls this with a one-item
// productIds array, no separate endpoint.
exports.bulkUpdatePricing = asyncHandler(async (req, res) => {
  const parsed = parsePricingParams(req.body);
  if (parsed.error) return sendError(res, parsed.error, 400);

  const preview = await buildPricingPreview(parsed.ids, parsed.direction, parsed.type, parsed.value);
  const includedItems = preview.items.filter((item) => !item.excluded);

  if (includedItems.length === 0) {
    return sendError(
      res,
      "No products were updated — every selected product would result in an invalid (≤ ₹0) price",
      400,
    );
  }

  const log = await sequelize.transaction(async (t) => {
    for (const item of includedItems) {
      for (const variant of item.variants) {
        await ProductVariant.update(
          { price: variant.newPrice },
          { where: { id: variant.variantId }, transaction: t },
        );
      }
    }

    return PriceUpdateLog.create(
      {
        adminId: req.admin.id,
        productIds: includedItems.map((item) => item.productId),
        direction: parsed.direction,
        type: parsed.type,
        value: parsed.value,
        affectedCount: includedItems.length,
      },
      { transaction: t },
    );
  });

  return sendSuccess(
    res,
    {
      updatedCount: includedItems.length,
      excludedCount: preview.summary.excludedCount,
      oldTotalValue: preview.summary.oldTotalValue,
      newTotalValue: preview.summary.newTotalValue,
      items: preview.items,
      logId: log.id,
    },
    `Updated pricing for ${includedItems.length} product${includedItems.length === 1 ? "" : "s"}`,
  );
});
