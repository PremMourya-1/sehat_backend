const express = require("express");
const router = express.Router();
const { applyCoupon } = require("../controllers/couponController");

router.post("/apply", applyCoupon);

module.exports = router;
