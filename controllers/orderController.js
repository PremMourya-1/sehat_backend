const { sequelize, Order, OrderItem, Product, ProductVariant, Cart, CartItem } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const calculateSubtotal = require("../utils/calculateSubtotal");
const evaluateCoupon = require("../utils/evaluateCoupon");
const generateOrderNumber = require("../utils/generateOrderNumber");
const { checkPincodeServiceability, parseWeightToKg } = require("../utils/shiprocket");
const { resolvePincodeLocation } = require("../utils/pincodeResolver");
const { getCodAvailability } = require("../utils/checkCodAvailability");
const { createRazorpayOrder, getRazorpayCredentials } = require("../utils/razorpay");
const { emitNewOrder } = require("../utils/socket");

const PINCODE_REGEX = /^[0-9]{6}$/;
const MIN_ORDER_WEIGHT_KG = 0.1;
const PAYMENT_METHODS = ["cod", "prepaid"];

const orderItemIncludes = [
  {
    model: OrderItem,
    include: [{ model: Product, attributes: ["id", "name", "image"] }],
  },
];

// POST /api/orders
// body: { items: [{ variantId, quantity }], couponCode?, shippingName, shippingPhone,
//         shippingAddress, shippingPincode, paymentMethod? ("cod" | "prepaid", defaults to "cod") }
// shippingCity/shippingState are never taken from the client — the customer
// only ever enters/confirms a pincode (checked up front on the product page,
// see checkoutController.checkPincode); city/state are resolved server-side
// below via resolvePincodeLocation() so Shiprocket's order payload has them.
exports.createOrder = asyncHandler(async (req, res) => {
  const {
    items,
    couponCode,
    shippingName,
    shippingPhone,
    shippingAddress,
    shippingPincode,
    paymentMethod = "cod",
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return sendError(res, "Order must contain at least one item", 400);
  }
  if (!shippingName || !shippingPhone || !shippingAddress || !shippingPincode) {
    return sendError(res, "Complete shipping details are required", 400);
  }
  if (!PINCODE_REGEX.test(shippingPincode)) {
    return sendError(res, "A valid 6-digit pincode is required", 400);
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return sendError(res, `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`, 400);
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

  // Defense in depth: the storefront already gates Buy Now/checkout behind
  // a serviceable pincode check, but a client-side gate is never trusted
  // alone — re-verify here with the order's real weight/COD amount.
  const totalWeightKg = Math.max(
    lineItems.reduce((sum, line) => sum + parseWeightToKg(line.weight) * line.quantity, 0),
    MIN_ORDER_WEIGHT_KG,
  );
  const serviceability = await checkPincodeServiceability(shippingPincode, totalWeightKg, total);
  if (!serviceability.serviceable) {
    return sendError(res, "Sorry, delivery isn't available to this pincode", 400);
  }

  const location = await resolvePincodeLocation(shippingPincode);
  if (!location) {
    return sendError(res, "Could not verify this pincode — please check and try again", 400);
  }

  // Defense in depth again: checkout only shows COD as selectable when it's
  // actually available, but never trust that alone — re-verify here too.
  if (paymentMethod === "cod") {
    const codAvailability = await getCodAvailability(lineItems);
    if (!codAvailability.available) {
      return sendError(res, codAvailability.reason || "Cash on Delivery is not available for this order", 400);
    }
  }

  // Everything below is one transaction — including the Razorpay order
  // creation for prepaid — so a failure anywhere (a network blip calling
  // Razorpay included) rolls back cleanly with no ghost order, no
  // decremented stock, nothing for a retry to collide with.
  let orderId;
  let razorpayInit = null;
  try {
    await sequelize.transaction(async (t) => {
      const order = await Order.create(
        {
          orderNumber: generateOrderNumber(),
          customerId: req.customer.id,
          subtotal,
          discountAmount,
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          total,
          paymentMethod,
          shippingName,
          shippingPhone,
          shippingAddress,
          shippingCity: location.city,
          shippingState: location.state,
          shippingPincode,
        },
        { transaction: t },
      );
      orderId = order.id;

      for (const line of lineItems) {
        await OrderItem.create(
          {
            orderId: order.id,
            productId: line.productId,
            variantId: line.variantId,
            weight: line.weight,
            price: line.price,
            quantity: line.quantity,
          },
          { transaction: t },
        );

        await ProductVariant.decrement("stock", {
          by: line.quantity,
          where: { id: line.variantId },
          transaction: t,
        });
      }

      if (appliedCoupon) {
        await appliedCoupon.increment("usedCount", { transaction: t });
      }

      // Clear the customer's persisted server-side cart, if one exists.
      const cart = await Cart.findOne({ where: { customerId: req.customer.id }, transaction: t });
      if (cart) await CartItem.destroy({ where: { cartId: cart.id }, transaction: t });

      if (paymentMethod === "prepaid") {
        const { keyId } = await getRazorpayCredentials();
        const razorpayOrder = await createRazorpayOrder({
          amount: total,
          receipt: order.orderNumber,
          notes: { orderId: order.id },
        });
        order.razorpayOrderId = razorpayOrder.id;
        await order.save({ transaction: t });
        razorpayInit = { razorpayOrderId: razorpayOrder.id, razorpayKeyId: keyId, amount: razorpayOrder.amount };
      }
    });
  } catch (err) {
    console.error(`Order creation failed: ${err.message}`);
    return sendError(
      res,
      paymentMethod === "prepaid"
        ? "Could not initiate online payment — please try again or choose Cash on Delivery"
        : "Could not place order — please try again",
      400,
    );
  }

  const fullOrder = await Order.findByPk(orderId, { include: orderItemIncludes });

  // COD orders are confirmed the moment they're placed — no separate payment
  // step — so this is where the admin gets notified. Prepaid orders notify
  // later, only once payment is actually verified (see checkoutController).
  if (paymentMethod === "cod") {
    emitNewOrder(fullOrder).catch((err) => console.error(`Failed to emit new-order notification: ${err.message}`));
  }

  return sendSuccess(res, { ...fullOrder.toJSON(), razorpay: razorpayInit }, "Order placed successfully", 201);
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
