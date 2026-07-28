const { Order, OrderItem, Product, ProductVariant, Cart, CartItem } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const calculateSubtotal = require("../utils/calculateSubtotal");
const evaluateCoupon = require("../utils/evaluateCoupon");
const generateOrderNumber = require("../utils/generateOrderNumber");

const orderItemIncludes = [
  {
    model: OrderItem,
    include: [{ model: Product, attributes: ["id", "name", "image"] }],
  },
];

// POST /api/orders
// body: { items: [{ variantId, quantity }], couponCode?, shippingName, shippingPhone,
//         shippingAddress, shippingCity, shippingState, shippingPincode }
exports.createOrder = asyncHandler(async (req, res) => {
  const {
    items,
    couponCode,
    shippingName,
    shippingPhone,
    shippingAddress,
    shippingCity,
    shippingState,
    shippingPincode,
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return sendError(res, "Order must contain at least one item", 400);
  }
  if (!shippingName || !shippingPhone || !shippingAddress || !shippingCity || !shippingState || !shippingPincode) {
    return sendError(res, "Complete shipping details are required", 400);
  }

  const subtotalResult = await calculateSubtotal(items);
  if (subtotalResult.error) return sendError(res, subtotalResult.error, 400);

  const { subtotal, items: lineItems } = subtotalResult;

  let discountAmount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const couponResult = await evaluateCoupon(couponCode, subtotal);
    if (couponResult.error) return sendError(res, couponResult.error, 400);
    discountAmount = couponResult.discountAmount;
    appliedCoupon = couponResult.coupon;
  }

  const total = Number((subtotal - discountAmount).toFixed(2));

  // Validate stock availability before committing the order.
  for (const line of lineItems) {
    const variant = await ProductVariant.findByPk(line.variantId);
    if (!variant || variant.stock < line.quantity) {
      return sendError(res, `Insufficient stock for one of the selected items`, 400);
    }
  }

  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    customerId: req.customer.id,
    subtotal,
    discountAmount,
    couponCode: appliedCoupon ? appliedCoupon.code : null,
    total,
    shippingName,
    shippingPhone,
    shippingAddress,
    shippingCity,
    shippingState,
    shippingPincode,
  });

  for (const line of lineItems) {
    await OrderItem.create({
      orderId: order.id,
      productId: line.productId,
      variantId: line.variantId,
      weight: line.weight,
      price: line.price,
      quantity: line.quantity,
    });

    await ProductVariant.decrement("stock", { by: line.quantity, where: { id: line.variantId } });
  }

  if (appliedCoupon) {
    await appliedCoupon.increment("usedCount");
  }

  // Clear the customer's persisted server-side cart, if one exists.
  const cart = await Cart.findOne({ where: { customerId: req.customer.id } });
  if (cart) await CartItem.destroy({ where: { cartId: cart.id } });

  const fullOrder = await Order.findByPk(order.id, { include: orderItemIncludes });
  return sendSuccess(res, fullOrder, "Order placed successfully", 201);
});

// GET /api/orders?page=&limit=
exports.getMyOrders = asyncHandler(async (req, res) => {
  const page = req.query.page ? Math.max(Number(req.query.page), 1) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  const offset = (page - 1) * limit;

  const { rows, count } = await Order.findAndCountAll({
    where: { customerId: req.customer.id },
    include: orderItemIncludes,
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return sendSuccess(res, {
    orders: rows,
    page,
    limit,
    total: count,
    totalPages: Math.ceil(count / limit),
  });
});

// GET /api/orders/recent — non-paginated, in-progress orders only
exports.getRecentOrders = asyncHandler(async (req, res) => {
  const orders = await Order.findAll({
    where: {
      customerId: req.customer.id,
      status: ["pending", "processing", "shipped"],
    },
    include: orderItemIncludes,
    order: [["createdAt", "DESC"]],
  });

  return sendSuccess(res, orders);
});

// GET /api/orders/:id
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    where: { id: req.params.id, customerId: req.customer.id },
    include: orderItemIncludes,
  });
  if (!order) return sendError(res, "Order not found", 404);
  return sendSuccess(res, order);
});
