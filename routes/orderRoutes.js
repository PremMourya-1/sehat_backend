const express = require("express");
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getRecentOrders,
  getLastOrderShipping,
  getOrderById,
  cancelOrder,
} = require("../controllers/orderController");
const customerAuth = require("../middleware/customerAuth");

router.use(customerAuth);

router.get("/recent", getRecentOrders);
// Must come before the "/:id" wildcard below, or Express would try to
// treat "last-shipping" as an order id.
router.get("/last-shipping", getLastOrderShipping);
router.get("/", getMyOrders);
router.get("/:id", getOrderById);
router.post("/", createOrder);
router.post("/:id/cancel", cancelOrder);

module.exports = router;
