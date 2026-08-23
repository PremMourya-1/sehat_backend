const { Op } = require("sequelize");
const { Expense } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const ALLOWED_ADDED_BY = Expense.ALLOWED_ADDED_BY;

// GET /api/expenses?addedBy=shinu|komal|all&startDate=&endDate=
exports.getExpenses = asyncHandler(async (req, res) => {
  const { addedBy, startDate, endDate } = req.query;
  const where = {};

  if (addedBy && addedBy !== "all") {
    if (!ALLOWED_ADDED_BY.includes(addedBy)) {
      return sendError(res, `addedBy must be one of: ${ALLOWED_ADDED_BY.join(", ")}, all`, 400);
    }
    where.addedBy = addedBy;
  }

  if (startDate || endDate) {
    where.purchaseDate = {};
    if (startDate) where.purchaseDate[Op.gte] = startDate;
    if (endDate) where.purchaseDate[Op.lte] = endDate;
  }

  const expenses = await Expense.findAll({
    where,
    order: [
      ["purchaseDate", "DESC"],
      ["createdAt", "DESC"],
    ],
  });

  const total = expenses.reduce((sum, expense) => sum + Number(expense.purchasePrice), 0);

  return sendSuccess(res, {
    expenses,
    total: Number(total.toFixed(2)),
    count: expenses.length,
  });
});

// POST /api/expenses  { itemName, purchasePrice, purchaseDate?, notes? }
// addedBy is deliberately never read from the request body — it always
// comes from the verified JWT (req.expenseUser.name, set by
// middleware/expensesAuth.js), so nobody can add an expense under the
// other person's name just by editing the request payload.
exports.createExpense = asyncHandler(async (req, res) => {
  const { itemName, purchasePrice, purchaseDate, notes } = req.body;

  if (!itemName || !String(itemName).trim()) {
    return sendError(res, "Item name is required", 400);
  }
  if (purchasePrice === undefined || purchasePrice === null || Number.isNaN(Number(purchasePrice))) {
    return sendError(res, "Purchase price is required", 400);
  }

  const expense = await Expense.create({
    itemName: String(itemName).trim(),
    purchasePrice: Number(purchasePrice),
    // Omitted entirely (not null) when purchaseDate is blank, so the
    // model's own defaultValue: DataTypes.NOW (today) applies.
    ...(purchaseDate ? { purchaseDate } : {}),
    addedBy: req.expenseUser.name,
    notes: notes ? String(notes).trim() : null,
  });

  return sendSuccess(res, expense, "Expense added successfully", 201);
});

// PATCH /api/expenses/:id — either user can edit either person's entry
// (shared household record), itemName/purchasePrice/purchaseDate/notes
// only. addedBy is never changed by an edit.
exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findByPk(req.params.id);
  if (!expense) return sendError(res, "Expense not found", 404);

  const { itemName, purchasePrice, purchaseDate, notes } = req.body;
  const updates = {};

  if (itemName !== undefined) {
    if (!String(itemName).trim()) return sendError(res, "Item name cannot be empty", 400);
    updates.itemName = String(itemName).trim();
  }
  if (purchasePrice !== undefined) {
    if (Number.isNaN(Number(purchasePrice))) return sendError(res, "Invalid purchase price", 400);
    updates.purchasePrice = Number(purchasePrice);
  }
  if (purchaseDate !== undefined) updates.purchaseDate = purchaseDate;
  if (notes !== undefined) updates.notes = notes ? String(notes).trim() : null;

  await expense.update(updates);
  return sendSuccess(res, expense, "Expense updated successfully");
});

// DELETE /api/expenses/:id — either user can delete either person's entry
// (shared record) — see confirm-dialog requirement on the frontend.
exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findByPk(req.params.id);
  if (!expense) return sendError(res, "Expense not found", 404);

  await expense.destroy();
  return sendSuccess(res, null, "Expense deleted successfully");
});
