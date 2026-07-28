const express = require("express");
const router = express.Router();
const { getHeroBanners } = require("../controllers/heroBannerController");

router.get("/", getHeroBanners);

module.exports = router;
