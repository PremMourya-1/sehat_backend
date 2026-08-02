const express = require("express");
const router = express.Router();

const adminAuth = require("../middleware/adminAuth");
const upload = require("../middleware/upload");

const { adminLogin, adminLogout, adminChangePassword } = require("../controllers/adminAuthController");
const { getDashboardStats } = require("../controllers/adminDashboardController");
const {
  getAllProducts,
  getProductById: getAdminProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/adminProductController");
const {
  getAllCategories,
  getCategoryById: getAdminCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/adminCategoryController");
const {
  getAllOrders,
  getOrderById: getAdminOrderById,
  updateOrderStatus,
} = require("../controllers/adminOrderController");
const { getAllCustomers, getCustomerById } = require("../controllers/adminCustomerController");
const {
  getAllCoupons,
  getCouponById,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require("../controllers/adminCouponController");
const {
  getAllHeroBanners,
  createHeroBanner,
  updateHeroBanner,
  deleteHeroBanner,
} = require("../controllers/adminHeroBannerController");
const {
  getAllTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
} = require("../controllers/adminTestimonialController");
const { getAllCmsPages, getCmsPageById, updateCmsPage } = require("../controllers/adminCmsController");
const {
  getAllComboOffers,
  createComboOffer,
  updateComboOffer,
  deleteComboOffer,
} = require("../controllers/adminComboOfferController");
const {
  getAllBlogPosts,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
} = require("../controllers/adminBlogPostController");
const { getAllFaqs, createFaq, updateFaq, deleteFaq } = require("../controllers/adminFaqController");
const {
  getAllSubscribers,
  deleteSubscriber,
} = require("../controllers/adminNewsletterController");
const {
  getIntegrationSettings,
  updateIntegrationSettings,
} = require("../controllers/adminIntegrationSettingsController");
const { getWebSettings, updateWebSettings } = require("../controllers/adminWebSettingsController");

// --- Auth (login is the only unauthenticated admin route) ---
router.post("/login", adminLogin);

// Everything below requires a valid admin_token cookie.
router.use(adminAuth);

router.post("/logout", adminLogout);
router.put("/change-password", adminChangePassword);

// --- Dashboard ---
router.get("/dashboard", getDashboardStats);

// --- Products ---
router.get("/products", getAllProducts);
router.get("/products/:id", getAdminProductById);
router.post("/products", upload.array("images", 6), createProduct);
router.put("/products/:id", upload.array("images", 6), updateProduct);
router.delete("/products/:id", deleteProduct);

// --- Categories ---
router.get("/categories", getAllCategories);
router.get("/categories/:id", getAdminCategoryById);
router.post("/categories", upload.single("image"), createCategory);
router.put("/categories/:id", upload.single("image"), updateCategory);
router.delete("/categories/:id", deleteCategory);

// --- Orders ---
router.get("/orders", getAllOrders);
router.get("/orders/:id", getAdminOrderById);
router.put("/orders/:id/status", updateOrderStatus);

// --- Customers (read-only) ---
router.get("/customers", getAllCustomers);
router.get("/customers/:id", getCustomerById);

// --- Coupons ---
router.get("/coupons", getAllCoupons);
router.get("/coupons/:id", getCouponById);
router.post("/coupons", createCoupon);
router.put("/coupons/:id", updateCoupon);
router.delete("/coupons/:id", deleteCoupon);

// --- Hero Banners ---
router.get("/hero-banners", getAllHeroBanners);
router.post("/hero-banners", upload.single("image"), createHeroBanner);
router.put("/hero-banners/:id", upload.single("image"), updateHeroBanner);
router.delete("/hero-banners/:id", deleteHeroBanner);

// --- Testimonials ---
router.get("/testimonials", getAllTestimonials);
router.post("/testimonials", upload.single("image"), createTestimonial);
router.put("/testimonials/:id", upload.single("image"), updateTestimonial);
router.delete("/testimonials/:id", deleteTestimonial);

// --- CMS pages (edit only, no add/delete) ---
router.get("/cms", getAllCmsPages);
router.get("/cms/:id", getCmsPageById);
router.put("/cms/:id", updateCmsPage);

// --- Combo Offers ---
router.get("/combo-offers", getAllComboOffers);
router.post("/combo-offers", createComboOffer);
router.put("/combo-offers/:id", updateComboOffer);
router.delete("/combo-offers/:id", deleteComboOffer);

// --- Blog Posts ---
router.get("/blog-posts", getAllBlogPosts);
router.post("/blog-posts", upload.single("image"), createBlogPost);
router.put("/blog-posts/:id", upload.single("image"), updateBlogPost);
router.delete("/blog-posts/:id", deleteBlogPost);

// --- FAQs ---
router.get("/faqs", getAllFaqs);
router.post("/faqs", createFaq);
router.put("/faqs/:id", updateFaq);
router.delete("/faqs/:id", deleteFaq);

// --- Newsletter Subscribers (read + delete only, no add/edit) ---
router.get("/newsletter-subscribers", getAllSubscribers);
router.delete("/newsletter-subscribers/:id", deleteSubscriber);

// --- Integration Settings (Shiprocket today; generic for future integrations) ---
router.get("/integrations/:key", getIntegrationSettings);
router.put("/integrations/:key", updateIntegrationSettings);

// --- Web Settings (site-wide business settings — COD toggle today) ---
router.get("/web-settings", getWebSettings);
router.put("/web-settings", updateWebSettings);

module.exports = router;
