const express = require("express");
const router = express.Router();
const { getBlogPosts, getBlogPostById } = require("../controllers/blogController");

router.get("/", getBlogPosts);
router.get("/:id", getBlogPostById);

module.exports = router;
