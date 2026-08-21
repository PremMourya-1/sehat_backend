const express = require("express");
const router = express.Router();
const { checkPincode, checkCodAvailability, getCheckoutConfig, verifyPayment } = require("../controllers/checkoutController");
const customerAuth = require("../middleware/customerAuth");

router.get("/config", getCheckoutConfig);
router.get("/check-pincode", checkPincode);
router.post("/cod-availability", checkCodAvailability);
// Scoped to the calling customer's own order — everything else in this
// router is public/pre-order, this one isn't.
router.post("/verify-payment", customerAuth, verifyPayment);

module.exports = router;
