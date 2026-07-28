const { Op } = require("sequelize");
const { HeroBanner, Category, Testimonial, ComboOffer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { serializeProduct, productIncludes } = require("./productController");
const { Product } = require("../models");

// GET /api/home — every piece of data the storefront homepage needs, in one
// call. Individual admin-managed resources still have their own public
// endpoints (used by other pages); this just aggregates the homepage subset.
// Note: "Build Your Own Mix", "Subscribe & Save" and "Why Choose Us" are
// static/hardcoded on the frontend (permanent content, not admin-managed),
// so they don't appear here. Blog posts are shown only on /blog, and FAQs
// only on the About page — neither is on the homepage.
exports.getHomeData = asyncHandler(async (req, res) => {
  const [
    banners,
    categories,
    featuredProducts,
    trendingProducts,
    giftHamperCategory,
    comboOffers,
    testimonials,
  ] = await Promise.all([
    HeroBanner.findAll({ where: { status: true }, order: [["sortOrder", "ASC"]] }),
    Category.findAll({ where: { status: true }, order: [["name", "ASC"]] }),
    Product.findAll({
      where: { status: true, showOnHome: true },
      include: productIncludes,
      limit: 8,
    }),
    Product.findAll({
      where: { status: true, isTrending: true },
      include: productIncludes,
      limit: 8,
    }),
    Category.findOne({ where: { status: true, name: { [Op.iLike]: "gift hamper%" } } }),
    ComboOffer.findAll({ where: { status: true }, order: [["sortOrder", "ASC"]] }),
    Testimonial.findAll({ where: { status: true }, order: [["createdAt", "DESC"]] }),
  ]);

  const giftHamperProducts = giftHamperCategory
    ? await Product.findAll({
        where: { status: true, categoryId: giftHamperCategory.id },
        include: productIncludes,
        limit: 8,
      })
    : [];

  return sendSuccess(res, {
    banners,
    categories,
    featuredProducts: featuredProducts.map(serializeProduct),
    trendingProducts: trendingProducts.map(serializeProduct),
    giftHamperProducts: giftHamperProducts.map(serializeProduct),
    comboOffers,
    testimonials,
  });
});
