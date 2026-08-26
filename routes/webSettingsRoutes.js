const express = require("express");
const router = express.Router();
const { getPublicLaunchCountdown } = require("../controllers/webSettingsController");

router.get("/launch-countdown", getPublicLaunchCountdown);

module.exports = router;
