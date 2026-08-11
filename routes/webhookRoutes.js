const express = require("express");
const router = express.Router();
const { razorpayWebhook, shiprocketWebhook } = require("../controllers/webhookController");

router.post("/razorpay", razorpayWebhook);
router.post("/shiprocket", shiprocketWebhook);

module.exports = router;
