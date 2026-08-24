const { Op } = require("sequelize");
const { Sale } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const ALLOWED_ADDED_BY = Sale.ALLOWED_ADDED_BY;

// GET /api/sales?addedBy=shinu|komal|all&startDate=&endDate=
exports.getSales = asyncHandler(async (req, res) => {
  const { addedBy, startDate, endDate } = req.query;
  const where = {};

  if (addedBy && addedBy !== "all") {
    if (!ALLOWED_ADDED_BY.includes(addedBy)) {
      return sendError(res, `addedBy must be one of: ${ALLOWED_ADDED_BY.join(", ")}, all`, 400);
    }
    where.addedBy = addedBy;
  }

  if (startDate || endDate) {
    where.saleDate = {};
    if (startDate) where.saleDate[Op.gte] = startDate;
    if (endDate) where.saleDate[Op.lte] = endDate;
  }

  const sales = await Sale.findAll({
    where,
    order: [
      ["saleDate", "DESC"],
      ["createdAt", "DESC"],
    ],
  });

  const total = sales.reduce((sum, sale) => sum + Number(sale.salePrice), 0);

  return sendSuccess(res, {
    sales,
    total: Number(total.toFixed(2)),
    count: sales.length,
  });
});

// POST /api/sales  { itemName, salePrice, saleDate?, notes? }
// addedBy is deliberately never read from the request body — it always
// comes from the verified JWT (req.expenseUser.name, set by
// middleware/expensesAuth.js — shared with the Expenses tracker, same
// login), so nobody can log a sale under the other person's name just by
// editing the request payload.
exports.createSale = asyncHandler(async (req, res) => {
  const { itemName, salePrice, saleDate, notes } = req.body;

  if (!itemName || !String(itemName).trim()) {
    return sendError(res, "Item name is required", 400);
  }
  if (salePrice === undefined || salePrice === null || Number.isNaN(Number(salePrice))) {
    return sendError(res, "Sale price is required", 400);
  }

  const sale = await Sale.create({
    itemName: String(itemName).trim(),
    salePrice: Number(salePrice),
    // Omitted entirely (not null) when saleDate is blank, so the model's
    // own defaultValue: DataTypes.NOW (today) applies.
    ...(saleDate ? { saleDate } : {}),
    addedBy: req.expenseUser.name,
    notes: notes ? String(notes).trim() : null,
  });

  return sendSuccess(res, sale, "Sale added successfully", 201);
});

// PATCH /api/sales/:id — either user can edit either person's entry
// (shared record), itemName/salePrice/saleDate/notes only. addedBy is
// never changed by an edit.
exports.updateSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findByPk(req.params.id);
  if (!sale) return sendError(res, "Sale not found", 404);

  const { itemName, salePrice, saleDate, notes } = req.body;
  const updates = {};

  if (itemName !== undefined) {
    if (!String(itemName).trim()) return sendError(res, "Item name cannot be empty", 400);
    updates.itemName = String(itemName).trim();
  }
  if (salePrice !== undefined) {
    if (Number.isNaN(Number(salePrice))) return sendError(res, "Invalid sale price", 400);
    updates.salePrice = Number(salePrice);
  }
  if (saleDate !== undefined) updates.saleDate = saleDate;
  if (notes !== undefined) updates.notes = notes ? String(notes).trim() : null;

  await sale.update(updates);
  return sendSuccess(res, sale, "Sale updated successfully");
});

// DELETE /api/sales/:id — either user can delete either person's entry
// (shared record) — see confirm-dialog requirement on the frontend.
exports.deleteSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findByPk(req.params.id);
  if (!sale) return sendError(res, "Sale not found", 404);

  await sale.destroy();
  return sendSuccess(res, null, "Sale deleted successfully");
});
