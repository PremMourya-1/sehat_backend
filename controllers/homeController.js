const { Op } = require("sequelize");
const { HeroBanner, Category, Testimonial, ComboOffer, ComboOfferItem, ProductVariant } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const { serializeProduct, productIncludes } = require("./productController");
const { Product } = require("../models");

const comboOfferIncludes = [
  {
    model: ComboOfferItem,
    as: "items",
    separate: true,
    order: [["sortOrder", "ASC"]],
    include: [
      { model: Product, attributes: ["id", "name", "image"] },
      { model: ProductVariant, as: "variant", attributes: ["id", "weight", "price", "mrp"] },
    ],
  },
];

// Adds a computed `individualTotal` (sum of each item's own variant price
// × quantity) alongside the stored `comboPrice`, so the storefront can show
// "you save ₹X" without recomputing combo math client-side.
function serializeComboOffer(offer) {
  const plain = offer.toJSON ? offer.toJSON() : offer;
  const individualTotal = (plain.items || []).reduce(
    (sum, item) => sum + Number(item.variant?.price || 0) * item.quantity,
    0,
  );
  return { ...plain, individualTotal: Number(individualTotal.toFixed(2)) };
}

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
    ComboOffer.findAll({ where: { status: true }, include: comboOfferIncludes, order: [["sortOrder", "ASC"]] }),
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
    // A combo with fewer than 2 items is either mid-edit in the admin panel
    // or — for anything left over from the old text-only version of this
    // feature (no ComboOfferItem rows at all) — genuinely incomplete: never
    // show it on the storefront regardless of `status`, since it would
    // otherwise render as an empty/₹0 "combo" with an Add to Cart button
    // that has nothing real to expand into (see Utils/cartExpansion.js on
    // the frontend).
    comboOffers: comboOffers.filter((offer) => (offer.items || []).length >= 2).map(serializeComboOffer),
    testimonials,
  });
});
