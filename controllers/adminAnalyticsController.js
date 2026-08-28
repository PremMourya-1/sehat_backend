const { Op, fn, col, literal } = require("sequelize");
const { sequelize, Order, OrderItem, Product } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const {
  startOfTodayIST,
  startOfWeekIST,
  startOfMonthIST,
  daysAgoIST,
  resolveRange,
} = require("../utils/analyticsDateRanges");

// Convention used consistently across every endpoint in this file: revenue
// and AOV always exclude "cancelled" orders (a cancelled order never
// realized any revenue, even though its `total` column still holds a real
// number) — same reasoning the best-sellers endpoint already needs to
// apply explicitly. Also excludes "payment_pending"/"payment_failed" —
// legacy customerStatus values from a since-replaced prepaid-checkout
// design (see models/Order.js's own comment) that no new order can reach,
// but a historical row could still carry if one was ever kept rather than
// deleted (see the AbandonedCheckout redesign) — never realized revenue
// either way. Plain order *counts* (top-line "Orders" stat, status
// breakdown, top locations, new-vs-returning) intentionally include every
// status, cancelled included, since those describe order *volume/activity*
// rather than money earned.
const REVENUE_ELIGIBLE = { customerStatus: { [Op.notIn]: ["cancelled", "payment_pending", "payment_failed"] } };

async function revenueAndCount(where) {
  const row = await Order.findOne({
    where: { ...where, ...REVENUE_ELIGIBLE },
    attributes: [
      [fn("COALESCE", fn("SUM", col("total")), 0), "revenue"],
      [fn("COUNT", col("id")), "orderCount"],
    ],
    raw: true,
  });
  const revenue = Number(row?.revenue || 0);
  const orderCount = Number(row?.orderCount || 0);
  return { revenue, orderCount, aov: orderCount ? revenue / orderCount : 0 };
}

async function totalOrderCount(where) {
  return Order.count({ where });
}

async function cancellationRate(where) {
  const [total, cancelled] = await Promise.all([
    Order.count({ where }),
    Order.count({ where: { ...where, customerStatus: "cancelled" } }),
  ]);
  return total ? (cancelled / total) * 100 : 0;
}

// GET /api/admin/analytics/overview — the always-on header stats (today,
// this week, this month, side by side — not affected by any date-range
// filter, unlike getBreakdown below).
exports.getOverview = asyncHandler(async (req, res) => {
  const now = new Date();
  const periods = {
    today: { [Op.gte]: startOfTodayIST(now) },
    week: { [Op.gte]: startOfWeekIST(now) },
    month: { [Op.gte]: startOfMonthIST(now) },
  };

  const [todayStats, weekStats, monthStats, todayRate, weekRate, monthRate, todayCount, weekCount, monthCount] =
    await Promise.all([
      revenueAndCount({ createdAt: periods.today }),
      revenueAndCount({ createdAt: periods.week }),
      revenueAndCount({ createdAt: periods.month }),
      cancellationRate({ createdAt: periods.today }),
      cancellationRate({ createdAt: periods.week }),
      cancellationRate({ createdAt: periods.month }),
      totalOrderCount({ createdAt: periods.today }),
      totalOrderCount({ createdAt: periods.week }),
      totalOrderCount({ createdAt: periods.month }),
    ]);

  return sendSuccess(res, {
    revenue: { today: todayStats.revenue, week: weekStats.revenue, month: monthStats.revenue },
    orders: { today: todayCount, week: weekCount, month: monthCount },
    averageOrderValue: { today: todayStats.aov, week: weekStats.aov, month: monthStats.aov },
    cancellationRate: { today: todayRate, week: weekRate, month: monthRate },
  });
});

// GET /api/admin/analytics/trends?days=30 — one daily-bucketed query per
// metric (SQL GROUP BY, not fetching every order into JS memory), buckets
// by IST calendar day via Postgres's AT TIME ZONE rather than JS-side
// grouping, so it stays correct regardless of how many orders exist.
exports.getTrends = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const since = daysAgoIST(days - 1); // inclusive of today => (days) buckets total

  const dayBucket = literal(`DATE("Order"."createdAt" AT TIME ZONE 'Asia/Kolkata')`);

  const [revenueRows, countRows] = await Promise.all([
    Order.findAll({
      where: { createdAt: { [Op.gte]: since }, ...REVENUE_ELIGIBLE },
      attributes: [
        [dayBucket, "date"],
        [fn("SUM", col("total")), "revenue"],
        [fn("COUNT", col("id")), "orderCount"],
      ],
      group: [dayBucket],
      order: [[dayBucket, "ASC"]],
      raw: true,
    }),
    Order.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: [
        [dayBucket, "date"],
        [fn("COUNT", col("id")), "totalCount"],
        [
          fn("COUNT", literal(`CASE WHEN "customerStatus" = 'cancelled' THEN 1 END`)),
          "cancelledCount",
        ],
      ],
      group: [dayBucket],
      raw: true,
    }),
  ]);

  const revenueByDate = new Map(revenueRows.map((r) => [r.date, r]));
  const countByDate = new Map(countRows.map((r) => [r.date, r]));

  const trend = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const dateKey = d.toISOString().slice(0, 10);
    const revRow = revenueByDate.get(dateKey);
    const cntRow = countByDate.get(dateKey);
    const revenue = Number(revRow?.revenue || 0);
    const orderCount = Number(revRow?.orderCount || 0);
    const totalCount = Number(cntRow?.totalCount || 0);
    const cancelledCount = Number(cntRow?.cancelledCount || 0);
    trend.push({
      date: dateKey,
      revenue,
      orderCount,
      averageOrderValue: orderCount ? revenue / orderCount : 0,
      cancellationRate: totalCount ? (cancelledCount / totalCount) * 100 : 0,
    });
  }

  return sendSuccess(res, trend);
});

// GET /api/admin/analytics/breakdown?range=today|week|month|custom&from&to
// — every widget here shares the same resolved date range, computed
// together since they all key off the same Order rows.
exports.getBreakdown = asyncHandler(async (req, res) => {
  const { start, end } = resolveRange(req.query);
  const createdAt = { [Op.gte]: start, [Op.lte]: end };

  const [statusRows, paymentRows, locationRows, customerRows] = await Promise.all([
    Order.findAll({
      where: { createdAt },
      attributes: ["customerStatus", [fn("COUNT", col("id")), "count"]],
      group: ["customerStatus"],
      raw: true,
    }),
    Order.findAll({
      where: { createdAt, ...REVENUE_ELIGIBLE },
      attributes: [
        "paymentMethod",
        [fn("COUNT", col("id")), "count"],
        [fn("COALESCE", fn("SUM", col("total")), 0), "revenue"],
      ],
      group: ["paymentMethod"],
      raw: true,
    }),
    Order.findAll({
      where: { createdAt, shippingState: { [Op.ne]: null } },
      attributes: ["shippingState", [fn("COUNT", col("id")), "count"]],
      group: ["shippingState"],
      order: [[literal("count"), "DESC"]],
      limit: 10,
      raw: true,
    }),
    // customerId + how many orders THAT customer has ever placed (all
    // time, any status) — used to classify each customer active in this
    // range as new (this range is their only order ever) vs returning
    // (2+ orders total). One correlated-subquery pass, not one query per
    // customer.
    Order.findAll({
      where: { createdAt },
      attributes: [
        "customerId",
        [
          literal(
            `(SELECT COUNT(*) FROM "Orders" AS "o2" WHERE "o2"."customerId" = "Order"."customerId")`,
          ),
          "lifetimeOrderCount",
        ],
      ],
      group: ["customerId"],
      raw: true,
    }),
  ]);

  const statusBreakdown = statusRows.map((r) => ({ status: r.customerStatus, count: Number(r.count) }));

  const codVsPrepaid = { cod: { count: 0, revenue: 0 }, prepaid: { count: 0, revenue: 0 } };
  paymentRows.forEach((r) => {
    if (r.paymentMethod === "cod" || r.paymentMethod === "prepaid") {
      codVsPrepaid[r.paymentMethod] = { count: Number(r.count), revenue: Number(r.revenue) };
    }
  });

  const topLocations = locationRows.map((r) => ({ state: r.shippingState, count: Number(r.count) }));

  let newCustomers = 0;
  let returningCustomers = 0;
  customerRows.forEach((r) => {
    if (Number(r.lifetimeOrderCount) >= 2) returningCustomers += 1;
    else newCustomers += 1;
  });

  return sendSuccess(res, {
    range: { start, end },
    statusBreakdown,
    codVsPrepaid,
    topLocations,
    newVsReturning: { new: newCustomers, returning: returningCustomers },
  });
});

// GET /api/admin/analytics/best-sellers?period=today|week|month|all&by=units|revenue&limit=10
exports.getBestSellers = asyncHandler(async (req, res) => {
  const period = ["today", "week", "month", "all"].includes(req.query.period) ? req.query.period : "month";
  const by = req.query.by === "revenue" ? "revenue" : "units";
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  const now = new Date();
  const orderWhere = { ...REVENUE_ELIGIBLE };
  if (period === "today") orderWhere.createdAt = { [Op.gte]: startOfTodayIST(now) };
  else if (period === "week") orderWhere.createdAt = { [Op.gte]: startOfWeekIST(now) };
  else if (period === "month") orderWhere.createdAt = { [Op.gte]: startOfMonthIST(now) };

  const rows = await OrderItem.findAll({
    attributes: [
      "productId",
      [fn("SUM", col("OrderItem.quantity")), "unitsSold"],
      [fn("SUM", literal(`"OrderItem"."price" * "OrderItem"."quantity"`)), "revenue"],
    ],
    include: [
      { model: Product, attributes: ["name", "image"] },
      { model: Order, attributes: [], where: orderWhere, required: true },
    ],
    where: { productId: { [Op.ne]: null } },
    group: ["OrderItem.productId", "Product.id"],
    order: [[literal(by === "revenue" ? "revenue" : '"unitsSold"'), "DESC"]],
    limit,
    subQuery: false,
  });

  const bestSellers = rows.map((r) => ({
    productId: r.productId,
    name: r.Product?.name || "Unknown product",
    image: r.Product?.image || null,
    unitsSold: Number(r.get("unitsSold")),
    revenue: Number(r.get("revenue")),
  }));

  return sendSuccess(res, bestSellers);
});
