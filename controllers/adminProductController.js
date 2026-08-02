const fs = require("fs");
const path = require("path");
const { Product, ProductImage, ProductVariant, Category } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const productIncludes = [
  { model: Category, attributes: ["id", "name"] },
  { model: ProductImage, as: "images", separate: true, order: [["sortOrder", "ASC"]] },
  { model: ProductVariant, as: "variants", separate: true, order: [["sortOrder", "ASC"]] },
];

function removeUploadedFile(filename) {
  if (!filename) return;
  const base = filename.replace(/^\/?uploads\//, "");
  fs.unlink(path.join("uploads", base), () => {});
}

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

function parseTags(raw) {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseVariants(raw) {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const NUTRITION_KEYS = ["calories", "protein", "fat", "carbs", "fiber"];

// Nutrition is only saved once every field has a value — a half-filled
// table would be worse than no table at all on the storefront.
function parseNutrition(raw) {
  if (raw === undefined || raw === "") return undefined;
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const hasAnyValue = NUTRITION_KEYS.some((k) => obj[k] !== undefined && obj[k] !== "" && obj[k] !== null);
  if (!hasAnyValue) return null;
  const result = {};
  for (const key of NUTRITION_KEYS) {
    const num = Number(obj[key]);
    result[key] = Number.isFinite(num) ? num : 0;
  }
  return result;
}

function parseComposition(raw) {
  if (raw === undefined || raw === "") return undefined;
  let arr;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const rows = arr
    .filter((row) => row && String(row.ingredient || "").trim())
    .map((row) => ({
      ingredient: String(row.ingredient).trim(),
      percentage: Number(row.percentage) || 0,
    }));
  return rows.length > 0 ? rows : null;
}

function validateTags(tags) {
  const invalid = tags.filter((t) => !Product.ALLOWED_TAGS.includes(t));
  return invalid;
}

function validateVariants(variants) {
  if (!variants.length) return "At least one weight variant is required";
  for (const v of variants) {
    if (!ProductVariant.ALLOWED_WEIGHTS.includes(v.weight)) {
      return `Invalid weight "${v.weight}". Allowed: ${ProductVariant.ALLOWED_WEIGHTS.join(", ")}`;
    }
    if (v.price === undefined || v.price === null || v.price === "") {
      return `Price is required for the ${v.weight} variant`;
    }
  }
  return null;
}

async function recomputeCoverImage(productId) {
  const firstImage = await ProductImage.findOne({
    where: { productId },
    order: [["sortOrder", "ASC"]],
  });
  await Product.update({ image: firstImage ? firstImage.image : null }, { where: { id: productId } });
}

// GET /api/admin/products
exports.getAllProducts = asyncHandler(async (req, res) => {
  const products = await Product.findAll({
    include: productIncludes,
    order: [["createdAt", "DESC"]],
  });
  return sendSuccess(res, products);
});

// GET /api/admin/products/:id
exports.getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findByPk(req.params.id, { include: productIncludes });
  if (!product) return sendError(res, "Product not found", 404);
  return sendSuccess(res, product);
});

// POST /api/admin/products  (multipart, up to 6 images)
exports.createProduct = asyncHandler(async (req, res) => {
  const { name, categoryId, shortDescription, longDescription, status, showOnHome, isTrending, codAvailable } =
    req.body;

  if (!name) return sendError(res, "Name is required", 400);

  const tags = parseTags(req.body.tags);
  const invalidTags = validateTags(tags);
  if (invalidTags.length) return sendError(res, `Invalid tag(s): ${invalidTags.join(", ")}`, 400);

  const variants = parseVariants(req.body.variants);
  const variantError = validateVariants(variants);
  if (variantError) return sendError(res, variantError, 400);

  const nutrition = parseNutrition(req.body.nutrition);
  const composition = parseComposition(req.body.composition);

  const product = await Product.create({
    name,
    categoryId: categoryId || null,
    shortDescription,
    longDescription,
    tags,
    status: toBool(status, true),
    showOnHome: toBool(showOnHome, false),
    isTrending: toBool(isTrending, false),
    codAvailable: toBool(codAvailable, true),
    nutrition: nutrition || null,
    composition: composition || null,
  });

  const files = req.files || [];
  for (let i = 0; i < files.length; i++) {
    await ProductImage.create({
      productId: product.id,
      image: `/uploads/${files[i].filename}`,
      sortOrder: i,
    });
  }

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    await ProductVariant.create({
      productId: product.id,
      weight: v.weight,
      mrp: v.mrp || null,
      price: v.price,
      stock: v.stock || 0,
      sortOrder: v.sortOrder !== undefined ? v.sortOrder : i,
    });
  }

  await recomputeCoverImage(product.id);

  const fullProduct = await Product.findByPk(product.id, { include: productIncludes });
  return sendSuccess(res, fullProduct, "Product created successfully", 201);
});

// PUT /api/admin/products/:id  (multipart, up to 6 new images, removeImageIds, variants)
exports.updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return sendError(res, "Product not found", 404);

  const { name, categoryId, shortDescription, longDescription, status, showOnHome, isTrending, codAvailable } =
    req.body;

  if (req.body.tags !== undefined) {
    const tags = parseTags(req.body.tags);
    const invalidTags = validateTags(tags);
    if (invalidTags.length) return sendError(res, `Invalid tag(s): ${invalidTags.join(", ")}`, 400);
    product.tags = tags;
  }

  if (name !== undefined) product.name = name;
  if (categoryId !== undefined) product.categoryId = categoryId || null;
  if (shortDescription !== undefined) product.shortDescription = shortDescription;
  if (longDescription !== undefined) product.longDescription = longDescription;
  if (status !== undefined) product.status = toBool(status, product.status);
  if (showOnHome !== undefined) product.showOnHome = toBool(showOnHome, product.showOnHome);
  if (isTrending !== undefined) product.isTrending = toBool(isTrending, product.isTrending);
  if (codAvailable !== undefined) product.codAvailable = toBool(codAvailable, product.codAvailable);
  if (req.body.nutrition !== undefined) product.nutrition = parseNutrition(req.body.nutrition) || null;
  if (req.body.composition !== undefined) product.composition = parseComposition(req.body.composition) || null;

  await product.save();

  // Remove specific existing images.
  if (req.body.removeImageIds) {
    let removeIds = [];
    try {
      removeIds = JSON.parse(req.body.removeImageIds);
    } catch {
      removeIds = [];
    }
    if (Array.isArray(removeIds) && removeIds.length) {
      const imagesToRemove = await ProductImage.findAll({
        where: { id: removeIds, productId: product.id },
      });
      for (const img of imagesToRemove) {
        removeUploadedFile(img.image);
        await img.destroy();
      }
    }
  }

  // Add newly uploaded images.
  const files = req.files || [];
  if (files.length) {
    const existingCount = await ProductImage.count({ where: { productId: product.id } });
    for (let i = 0; i < files.length; i++) {
      await ProductImage.create({
        productId: product.id,
        image: `/uploads/${files[i].filename}`,
        sortOrder: existingCount + i,
      });
    }
  }

  await recomputeCoverImage(product.id);

  // Sync variants: update existing (by id), create new (no id), delete missing.
  if (req.body.variants !== undefined) {
    const variants = parseVariants(req.body.variants);
    const variantError = validateVariants(variants);
    if (variantError) return sendError(res, variantError, 400);

    const existingVariants = await ProductVariant.findAll({ where: { productId: product.id } });
    const incomingIds = variants.filter((v) => v.id).map((v) => v.id);

    for (const existing of existingVariants) {
      if (!incomingIds.includes(existing.id)) {
        await existing.destroy();
      }
    }

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (v.id) {
        await ProductVariant.update(
          {
            weight: v.weight,
            mrp: v.mrp || null,
            price: v.price,
            stock: v.stock || 0,
            sortOrder: v.sortOrder !== undefined ? v.sortOrder : i,
          },
          { where: { id: v.id, productId: product.id } },
        );
      } else {
        await ProductVariant.create({
          productId: product.id,
          weight: v.weight,
          mrp: v.mrp || null,
          price: v.price,
          stock: v.stock || 0,
          sortOrder: v.sortOrder !== undefined ? v.sortOrder : i,
        });
      }
    }
  }

  const fullProduct = await Product.findByPk(product.id, { include: productIncludes });
  return sendSuccess(res, fullProduct, "Product updated successfully");
});

// DELETE /api/admin/products/:id
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByPk(req.params.id, {
    include: [{ model: ProductImage, as: "images" }],
  });
  if (!product) return sendError(res, "Product not found", 404);

  for (const img of product.images || []) {
    removeUploadedFile(img.image);
  }

  await product.destroy();
  return sendSuccess(res, null, "Product deleted successfully");
});
