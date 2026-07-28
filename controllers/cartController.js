const { Cart, CartItem, Product, ProductVariant, ProductImage } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

const cartItemIncludes = [
  {
    model: Product,
    attributes: ["id", "name", "image", "status"],
    include: [{ model: ProductImage, as: "images", attributes: ["id", "image", "sortOrder"] }],
  },
  {
    model: ProductVariant,
    as: "variant",
    attributes: ["id", "weight", "mrp", "price", "stock"],
  },
];

async function getOrCreateCart(customerId) {
  let cart = await Cart.findOne({ where: { customerId } });
  if (!cart) cart = await Cart.create({ customerId });
  return cart;
}

// GET /api/cart
exports.getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.customer.id);
  const items = await CartItem.findAll({ where: { cartId: cart.id }, include: cartItemIncludes });
  return sendSuccess(res, { cartId: cart.id, items });
});

// POST /api/cart  { variantId, quantity }
exports.addToCart = asyncHandler(async (req, res) => {
  const { variantId, quantity } = req.body;
  if (!variantId) return sendError(res, "variantId is required", 400);

  const variant = await ProductVariant.findByPk(variantId);
  if (!variant) return sendError(res, "Product variant not found", 404);

  const cart = await getOrCreateCart(req.customer.id);
  const qty = Number(quantity) > 0 ? Number(quantity) : 1;

  let item = await CartItem.findOne({ where: { cartId: cart.id, variantId } });
  if (item) {
    item.quantity += qty;
    await item.save();
  } else {
    item = await CartItem.create({
      cartId: cart.id,
      productId: variant.productId,
      variantId,
      quantity: qty,
    });
  }

  const populated = await CartItem.findByPk(item.id, { include: cartItemIncludes });
  return sendSuccess(res, populated, "Item added to cart");
});

// PUT /api/cart/:itemId  { quantity }
exports.updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || Number(quantity) < 1) return sendError(res, "Valid quantity is required", 400);

  const cart = await getOrCreateCart(req.customer.id);
  const item = await CartItem.findOne({ where: { id: req.params.itemId, cartId: cart.id } });
  if (!item) return sendError(res, "Cart item not found", 404);

  item.quantity = Number(quantity);
  await item.save();

  const populated = await CartItem.findByPk(item.id, { include: cartItemIncludes });
  return sendSuccess(res, populated, "Cart item updated");
});

// DELETE /api/cart/:itemId
exports.removeCartItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.customer.id);
  const item = await CartItem.findOne({ where: { id: req.params.itemId, cartId: cart.id } });
  if (!item) return sendError(res, "Cart item not found", 404);

  await item.destroy();
  return sendSuccess(res, null, "Item removed from cart");
});

// DELETE /api/cart
exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.customer.id);
  await CartItem.destroy({ where: { cartId: cart.id } });
  return sendSuccess(res, null, "Cart cleared");
});
