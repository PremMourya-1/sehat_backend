const express = require("express");
const router = express.Router();
const { getTestimonials } = require("../controllers/testimonialController");

router.get("/", getTestimonials);

module.exports = router;
