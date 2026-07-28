const express = require("express");
const router = express.Router();
const { getFaqs } = require("../controllers/faqController");

router.get("/", getFaqs);

module.exports = router;
