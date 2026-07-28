const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const {
  getProducts,
  getProductById,
  searchProducts,
  getFeaturedProducts,
  browseProducts,
} = require("../controllers/productController");
const { getReviews, verifyOrder, createReview } = require("../controllers/reviewController");

router.get("/search", searchProducts);
router.get("/featured", getFeaturedProducts);
router.get("/browse", browseProducts);
router.get("/", getProducts);
router.get("/:id", getProductById);

router.get("/:id/reviews", getReviews);
router.post("/:id/reviews/verify", verifyOrder);
router.post("/:id/reviews", upload.single("photo"), createReview);

module.exports = router;
