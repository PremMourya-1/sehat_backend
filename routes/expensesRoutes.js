const express = require("express");
const router = express.Router();

const expensesAuth = require("../middleware/expensesAuth");
const { expensesLogin } = require("../controllers/expensesAuthController");
const {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
} = require("../controllers/expensesController");

// Entirely separate auth system from the admin panel (see EXPENSES.md) —
// login is the only route here without expensesAuth, and expensesAuth
// itself is never mounted anywhere outside this router.
router.post("/login", expensesLogin);

router.use(expensesAuth);

router.get("/", getExpenses);
router.post("/", createExpense);
router.patch("/:id", updateExpense);
router.delete("/:id", deleteExpense);

module.exports = router;
