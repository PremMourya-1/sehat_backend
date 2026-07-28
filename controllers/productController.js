const { Op } = require("sequelize");
const { sequelize, Product, Category, ProductImage, ProductVariant } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const productIncludes = [
  { model: Category, attributes: ["id", "name"] },
  {
    model: ProductImage,
    as: "images",
    attributes: ["id", "image", "sortOrder"],
    separate: true,
    order: [["sortOrder", "ASC"]],
  },
  {
    model: ProductVariant,
    as: "variants",
    attributes: ["id", "weight", "mrp", "price", "stock", "sortOrder"],
    separate: true,
    order: [["sortOrder", "ASC"]],
  },
];

// Shapes a Sequelize Product instance into the public API response contract
// described in the Sehat Potli domain spec (nested `category`, `images`,
// `variants`).
function serializeProduct(product) {
  const p = product.toJSON ? product.toJSON() : product;
  return {
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    category: p.Category ? { id: p.Category.id, name: p.Category.name } : null,
    shortDescription: p.shortDescription,
    longDescription: p.longDescription,
    image: p.image,
    images: (p.images || []).map((img) => ({ id: img.id, image: img.image, sortOrder: img.sortOrder })),
    tags: p.tags || [],
    status: p.status,
    showOnHome: p.showOnHome,
    nutrition: p.nutrition || null,
    composition: p.composition || null,
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      weight: v.weight,
      mrp: v.mrp,
      price: v.price,
      stock: v.stock,
      sortOrder: v.sortOrder,
    })),
  };
}

// GET /api/products?categoryId=
exports.getProducts = asyncHandler(async (req, res) => {
  const where = { status: true };
  if (req.query.categoryId) where.categoryId = req.query.categoryId;

  const products = await Product.findAll({
    where,
    include: productIncludes,
    order: [["createdAt", "DESC"]],
  });

  return sendSuccess(res, products.map(serializeProduct));
});

// GET /api/products/:id
exports.getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    where: { id: req.params.id, status: true },
    include: productIncludes,
  });

  if (!product) return sendError(res, "Product not found", 404);
  return sendSuccess(res, serializeProduct(product));
});

// GET /api/products/search?q=
exports.searchProducts = asyncHandler(async (req, res) => {
  const q = req.query.q || "";
  if (!q.trim()) return sendSuccess(res, []);

  const products = await Product.findAll({
    where: {
      status: true,
      [Op.or]: [{ name: { [Op.iLike]: `%${q}%` } }, { shortDescription: { [Op.iLike]: `%${q}%` } }],
    },
    include: productIncludes,
    order: [["createdAt", "DESC"]],
    limit: 40,
  });

  return sendSuccess(res, products.map(serializeProduct));
});

// GET /api/products/featured
exports.getFeaturedProducts = asyncHandler(async (req, res) => {
  const products = await Product.findAll({
    where: { status: true, showOnHome: true },
    include: productIncludes,
    order: sequelize.random(),
    limit: req.query.limit ? Number(req.query.limit) : 12,
  });

  return sendSuccess(res, products.map(serializeProduct));
});

// GET /api/products/browse?cursor=&limit=&categoryId=
// Cursor-based pagination using `id` as an opaque-ish cursor (createdAt+id
// composite ordering, limit+1 trick to detect hasMore).
exports.browseProducts = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 12;
  const where = { status: true };
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.excludeId) where.id = { [Op.ne]: req.query.excludeId };

  if (req.query.cursor) {
    where.id = { ...(where.id || {}), [Op.gt]: req.query.cursor };
  }

  const products = await Product.findAll({
    where,
    include: productIncludes,
    order: [["id", "ASC"]],
    limit: limit + 1,
  });

  const hasMore = products.length > limit;
  const page = hasMore ? products.slice(0, limit) : products;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return sendSuccess(res, {
    items: page.map(serializeProduct),
    hasMore,
    nextCursor,
  });
});

exports.serializeProduct = serializeProduct;
exports.productIncludes = productIncludes;
