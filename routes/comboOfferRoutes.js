const express = require("express");
const router = express.Router();
const { getComboOfferById } = require("../controllers/comboOfferController");

router.get("/:id", getComboOfferById);

module.exports = router;
