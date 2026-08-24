const express = require("express");
const router = express.Router();

// Reuses the exact same auth as Expenses (routes/expensesRoutes.js) — one
// shared Shinu/Komal login for the whole Finance mini-app, not a separate
// system. Login itself stays at POST /api/expenses/login; there's no
// /api/sales/login.
const expensesAuth = require("../middleware/expensesAuth");
const {
  getSales,
  createSale,
  updateSale,
  deleteSale,
} = require("../controllers/salesController");

router.use(expensesAuth);

router.get("/", getSales);
router.post("/", createSale);
router.patch("/:id", updateSale);
router.delete("/:id", deleteSale);

module.exports = router;
