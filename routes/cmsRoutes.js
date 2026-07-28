const express = require("express");
const router = express.Router();
const { getCmsPageBySlug } = require("../controllers/cmsController");

router.get("/:slug", getCmsPageBySlug);

module.exports = router;
