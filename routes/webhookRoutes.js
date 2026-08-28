const express = require("express");
const router = express.Router();
const { razorpayWebhook, shiprocketWebhook, whatsappVerifyWebhook, whatsappWebhook } = require("../controllers/webhookController");

router.post("/razorpay", razorpayWebhook);
// Deliberately not named "shiprocket"/"kartrocket"/"sr"/"kr" — Shiprocket's
// own webhook config form warns those strings in the URL can get it
// misfiltered/blocked. Handler is still shiprocketWebhook (internal name,
// never sent over the wire).
router.post("/courier-updates", shiprocketWebhook);
// GET is Meta's one-time verification handshake, POST is the actual event
// stream — both registered at the same URL, which is what Meta expects
// (one "Callback URL" configured for both).
router.get("/whatsapp", whatsappVerifyWebhook);
router.post("/whatsapp", whatsappWebhook);

module.exports = router;
