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

// POST /api/cart/merge  { items: [{ variantId, quantity }] }
// Called once, right after a guest with items sitting in their
// localStorage cart logs in (see sehat-potli-front's StoreProvider.js) —
// combines those into whatever's already in this customer's DB cart
// (e.g. left over from a previous session on another device). An empty
// `items` array is a valid, common call (nothing to merge) and just
// returns the customer's existing cart as-is — effectively "load my
// cart" for an already-logged-in return visit.
//
// Overlapping variants SUM their quantities rather than taking the
// higher of the two: the ordinary case is the exact same item
// independently added on two separate sessions/devices, and a customer
// expects both adds to count — this is the same rule addToCart above
// already applies to a repeat add of the same variant within one
// session, so merge just extends it across sessions instead of picking
// a different, surprising rule for the same situation.
exports.mergeCart = asyncHandler(async (req, res) => {
  const { items } = req.body;
  const cart = await getOrCreateCart(req.customer.id);

  if (Array.isArray(items)) {
    for (const entry of items) {
      const variantId = entry?.variantId;
      if (!variantId) continue;
      const quantity = Number(entry.quantity) > 0 ? Number(entry.quantity) : 1;

      const variant = await ProductVariant.findByPk(variantId);
      if (!variant) continue; // stale/deleted variant from an old localStorage cart

      const existing = await CartItem.findOne({ where: { cartId: cart.id, variantId } });
      if (existing) {
        existing.quantity += quantity;
        await existing.save();
      } else {
        await CartItem.create({ cartId: cart.id, productId: variant.productId, variantId, quantity });
      }
    }
  }

  const mergedItems = await CartItem.findAll({ where: { cartId: cart.id }, include: cartItemIncludes });
  return sendSuccess(res, { cartId: cart.id, items: mergedItems }, "Cart merged successfully");
});

// PUT /api/cart/sync  { items: [{ variantId, quantity }] }
// A full replace, not an incremental update — called on a debounce for
// every cart change a logged-in customer makes (StoreProvider.js again).
// Once logged in, the frontend's Redux cart is already the authoritative
// in-progress state (every add/update/remove happened there instantly
// for a responsive UI, no round-trip needed) — this just mirrors that
// exact state into the DB so it survives a reload or shows up on another
// device. Simpler and more robust than threading individual CartItem row
// ids back to the client to support granular add/update/remove calls.
exports.syncCart = asyncHandler(async (req, res) => {
  const { items } = req.body;
  const cart = await getOrCreateCart(req.customer.id);

  await CartItem.destroy({ where: { cartId: cart.id } });

  if (Array.isArray(items)) {
    for (const entry of items) {
      const variantId = entry?.variantId;
      if (!variantId) continue;
      const quantity = Number(entry.quantity) > 0 ? Number(entry.quantity) : 1;

      const variant = await ProductVariant.findByPk(variantId);
      if (!variant) continue;

      await CartItem.create({ cartId: cart.id, productId: variant.productId, variantId, quantity });
    }
  }

  return sendSuccess(res, null, "Cart synced");
});
