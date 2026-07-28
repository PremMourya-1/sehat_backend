const express = require("express");
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getRecentOrders,
  getOrderById,
} = require("../controllers/orderController");
const customerAuth = require("../middleware/customerAuth");

router.use(customerAuth);

router.get("/recent", getRecentOrders);
router.get("/", getMyOrders);
router.get("/:id", getOrderById);
router.post("/", createOrder);

module.exports = router;
