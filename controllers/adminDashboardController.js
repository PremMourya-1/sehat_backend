const { Product, Category, Order, Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// GET /api/admin/dashboard
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const [totalProducts, totalCategories, totalOrders, totalCustomers, orders] = await Promise.all([
    Product.count(),
    Category.count(),
    Order.count(),
    Customer.count(),
    Order.findAll({ attributes: ["total"] }),
  ]);

  const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  return sendSuccess(res, {
    totalProducts,
    totalCategories,
    totalOrders,
    totalCustomers,
    totalRevenue: Number(totalRevenue.toFixed(2)),
  });
});
