const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const customerAuth = require("../middleware/customerAuth");
const {
  getProducts,
  getProductById,
  searchProducts,
  getFeaturedProducts,
  browseProducts,
} = require("../controllers/productController");
const { getReviews, createReview } = require("../controllers/reviewController");

router.get("/search", searchProducts);
router.get("/featured", getFeaturedProducts);
router.get("/browse", browseProducts);
router.get("/", getProducts);
router.get("/:id", getProductById);

router.get("/:id/reviews", getReviews);
router.post("/:id/reviews", customerAuth, upload.array("photos", 5), createReview);

module.exports = router;
