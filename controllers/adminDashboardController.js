const { Op } = require("sequelize");
const { Product, Category, Order, Customer } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { getWalletBalance } = require("../utils/shiprocket");

// Same revenue-eligibility rule as controllers/adminAnalyticsController.js's
// own REVENUE_ELIGIBLE — cancelled orders never realized any revenue even
// though their `total` column still holds a real number, and
// payment_pending/payment_failed are legacy customerStatus values from a
// since-replaced prepaid-checkout design that never realized revenue
// either (see models/Order.js). `totalOrders` intentionally stays an
// unfiltered count — that describes order volume, not money earned.
const REVENUE_ELIGIBLE = { customerStatus: { [Op.notIn]: ["cancelled", "payment_pending", "payment_failed"] } };

// GET /api/admin/dashboard
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const [totalProducts, totalCategories, totalOrders, totalCustomers, orders] = await Promise.all([
    Product.count(),
    Category.count(),
    Order.count(),
    Customer.count(),
    Order.findAll({ where: REVENUE_ELIGIBLE, attributes: ["total"] }),
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

// Simple in-memory TTL cache — one process-wide value, no per-user variance,
// so this is fine without anything more elaborate (Redis, etc.). Cleared
// implicitly on a deploy/restart; nothing else needs to invalidate it.
const WALLET_BALANCE_CACHE_TTL_MS = 5 * 60 * 1000;
let walletBalanceCache = { balance: null, fetchedAt: 0 };

// GET /api/admin/dashboard/wallet-balance — separate from getDashboardStats
// above so a slow/failed Shiprocket call never blocks the rest of the
// dashboard from loading.
exports.getWalletBalanceStat = asyncHandler(async (req, res) => {
  const isFresh = Date.now() - walletBalanceCache.fetchedAt < WALLET_BALANCE_CACHE_TTL_MS;
  if (isFresh && walletBalanceCache.balance !== null) {
    return sendSuccess(res, { balance: walletBalanceCache.balance, cached: true });
  }

  try {
    const balance = await getWalletBalance();
    walletBalanceCache = { balance, fetchedAt: Date.now() };
    return sendSuccess(res, { balance, cached: false });
  } catch (err) {
    console.error(`Shiprocket wallet balance: ${err.message}`);
    return sendError(res, "Could not fetch Shiprocket wallet balance", 502);
  }
});
