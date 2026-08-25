const express = require("express");
const router = express.Router();
const { getPublicCartRewardTiers } = require("../controllers/cartRewardController");

router.get("/", getPublicCartRewardTiers);

module.exports = router;
