const express = require("express");
const router = express.Router();
const { sendOtp, verifyOtp } = require("../controllers/mobileVerificationController");
const customerAuth = require("../middleware/customerAuth");

router.use(customerAuth);

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

module.exports = router;
