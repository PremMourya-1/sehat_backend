const express = require("express");
const router = express.Router();
const { razorpayWebhook } = require("../controllers/webhookController");

router.post("/razorpay", razorpayWebhook);

module.exports = router;
