const express = require("express");
const router = express.Router();
const {
  getCart,
  addToCart,
  mergeCart,
  syncCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require("../controllers/cartController");
const customerAuth = require("../middleware/customerAuth");

router.use(customerAuth);

router.get("/", getCart);
router.post("/", addToCart);
router.post("/merge", mergeCart);
// /sync must be registered before the /:itemId wildcard below, or Express
// would match a PUT to "/sync" as updateCartItem with itemId="sync".
router.put("/sync", syncCart);
router.put("/:itemId", updateCartItem);
router.delete("/:itemId", removeCartItem);
router.delete("/", clearCart);

module.exports = router;
