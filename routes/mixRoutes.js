const express = require("express");
const router = express.Router();
const { getMixIngredients } = require("../controllers/mixController");

router.get("/", getMixIngredients);

module.exports = router;
