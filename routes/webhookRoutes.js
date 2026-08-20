const express = require("express");
const router = express.Router();
const { razorpayWebhook, shiprocketWebhook } = require("../controllers/webhookController");

router.post("/razorpay", razorpayWebhook);
// Deliberately not named "shiprocket"/"kartrocket"/"sr"/"kr" — Shiprocket's
// own webhook config form warns those strings in the URL can get it
// misfiltered/blocked. Handler is still shiprocketWebhook (internal name,
// never sent over the wire).
router.post("/courier-updates", shiprocketWebhook);

module.exports = router;
