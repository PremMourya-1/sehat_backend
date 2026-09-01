const { Op, fn, col, literal } = require("sequelize");
const { Order, OrderItem, Product } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const { resolveRange } = require("../utils/analyticsDateRanges");
const { REVENUE_ELIGIBLE } = require("../utils/revenueEligibility");

// First feature under the new "Inventory" admin section — see
// adminRoutesData.js/adminSideBarData.jsx on the frontend. Both endpoints
// below deliberately REQUIRE startDate/endDate (400 if either is missing —
// this is enforced here, not just hidden behind an empty frontend state,
// since the whole point is never letting an admin accidentally pull every
// order ever placed in one query as history grows) and use the same
// utils/revenueEligibility.js REVENUE_ELIGIBLE rule as the analytics
// dashboard (excludes cancelled + legacy payment_pending/payment_failed —
// consistent "what counts as a sale" definition everywhere in the admin).
//
// Every aggregate here is computed in SQL (Sequelize group/fn/literal) —
// nothing fetches raw Order/OrderItem rows into memory and sums them in
// JS, so this stays fast regardless of how large order history grows.
const MAX_RANGE_DAYS = 366;

// Shared by both endpoints below. Returns { error } (a ready-to-send 400
// message) or { start, end } — start/end are real Date instants resolved
// via the exact same custom-range logic (IST day boundaries) the admin
// analytics dashboard already uses (utils/analyticsDateRanges.js
// resolveRange), just without that function's own "defaults to today if
// nothing is passed" behavior, which is exactly the opposite of what a
// report that must never silently load everything wants.
function parseRequiredDateRange(query) {
  const { startDate, endDate } = query;
  if (!startDate || !endDate) {
    return { error: "startDate and endDate are required (YYYY-MM-DD)" };
  }
  const { start, end } = resolveRange({ range: "custom", from: startDate, to: endDate });
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "startDate and endDate must be valid dates" };
  }
  if (start > end) {
    return { error: "startDate must be before endDate" };
  }
  const rangeDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  if (rangeDays > MAX_RANGE_DAYS) {
    return { error: `Date range too large — max ${MAX_RANGE_DAYS} days at once` };
  }
  return { start, end };
}

// GET /api/admin/reports/sales/by-product?startDate&endDate&productId?&categoryId?&sortBy?(revenue|units)&sortDir?(asc|desc)
exports.getSalesByProduct = asyncHandler(async (req, res) => {
  const parsed = parseRequiredDateRange(req.query);
  if (parsed.error) return sendError(res, parsed.error, 400);
  const { start, end } = parsed;

  const { productId, categoryId } = req.query;
  const sortByUnits = req.query.sortBy === "units";
  const direction = req.query.sortDir === "asc" ? "ASC" : "DESC";

  const itemWhere = { productId: { [Op.ne]: null } };
  if (productId) itemWhere.productId = productId;

  const productInclude = { model: Product, attributes: ["id", "name", "image"], required: true };
  if (categoryId) productInclude.where = { categoryId };

  const orderInclude = {
    model: Order,
    attributes: [],
    where: { createdAt: { [Op.gte]: start, [Op.lte]: end }, ...REVENUE_ELIGIBLE },
    required: true,
  };

  // Second, leaner query grouped one step further by OrderItem.weight (the
  // pack-size snapshot, e.g. "250g"/"1kg") so each product row below can
  // show a per-variant breakdown ("which pack size sold how much") without
  // splitting the top-level, sortable one-row-per-product table itself.
  const variantProductJoin = { model: Product, attributes: [], required: true };
  if (categoryId) variantProductJoin.where = { categoryId };

  const [totalRows, variantRows] = await Promise.all([
    OrderItem.findAll({
      attributes: [
        "productId",
        [fn("SUM", col("OrderItem.quantity")), "unitsSold"],
        [fn("SUM", literal(`"OrderItem"."price" * "OrderItem"."quantity"`)), "revenue"],
      ],
      include: [productInclude, orderInclude],
      where: itemWhere,
      group: ["OrderItem.productId", "Product.id"],
      order: [[literal(sortByUnits ? '"unitsSold"' : "revenue"), direction]],
      subQuery: false,
    }),
    OrderItem.findAll({
      attributes: [
        "productId",
        "weight",
        [fn("SUM", col("OrderItem.quantity")), "unitsSold"],
        [fn("SUM", literal(`"OrderItem"."price" * "OrderItem"."quantity"`)), "revenue"],
      ],
      include: [variantProductJoin, orderInclude],
      where: itemWhere,
      group: ["OrderItem.productId", "OrderItem.weight"],
      subQuery: false,
      raw: true,
    }),
  ]);

  const variantsByProduct = new Map();
  for (const row of variantRows) {
    const list = variantsByProduct.get(row.productId) || [];
    list.push({
      weight: row.weight || "Unspecified",
      unitsSold: Number(row.unitsSold),
      revenue: Number(row.revenue),
    });
    variantsByProduct.set(row.productId, list);
  }

  const products = totalRows.map((r) => ({
    productId: r.productId,
    name: r.Product?.name || "Unknown product",
    image: r.Product?.image || null,
    unitsSold: Number(r.get("unitsSold")),
    revenue: Number(r.get("revenue")),
    variants: variantsByProduct.get(r.productId) || [],
  }));

  return sendSuccess(res, { range: { start, end }, products });
});

// GET /api/admin/reports/sales/by-date?startDate&endDate
// One day-total query + one day+product query (same 2-query shape as
// adminAnalyticsController.getTrends) — the per-day product breakdown is
// nested onto each day row in JS afterward, but that's just reshaping
// already-fully-aggregated SQL rows into a tree, not computing sums from
// raw data.
exports.getSalesByDate = asyncHandler(async (req, res) => {
  const parsed = parseRequiredDateRange(req.query);
  if (parsed.error) return sendError(res, parsed.error, 400);
  const { start, end } = parsed;

  const orderWhere = { createdAt: { [Op.gte]: start, [Op.lte]: end }, ...REVENUE_ELIGIBLE };
  const dayBucket = literal(`DATE("Order"."createdAt" AT TIME ZONE 'Asia/Kolkata')`);

  const [dailyTotals, productRows] = await Promise.all([
    // Deliberately sums OrderItem line revenue (price * quantity), the
    // same basis the per-product breakdown below uses — NOT Order.total
    // (which nets out any coupon discount / adds shipping). Using
    // Order.total here would make day.revenue not equal the sum of
    // day.products[].revenue whenever a coupon or shipping charge was
    // involved, which reads as "these numbers don't add up" to anyone
    // comparing the two on this same report.
    OrderItem.findAll({
      attributes: [
        [dayBucket, "date"],
        [fn("SUM", literal(`"OrderItem"."price" * "OrderItem"."quantity"`)), "revenue"],
        [fn("COUNT", fn("DISTINCT", col("Order.id"))), "orderCount"],
      ],
      include: [{ model: Order, attributes: [], where: orderWhere, required: true }],
      where: { productId: { [Op.ne]: null } },
      group: [dayBucket],
      order: [[dayBucket, "ASC"]],
      subQuery: false,
      raw: true,
    }),
    OrderItem.findAll({
      attributes: [
        [dayBucket, "date"],
        "productId",
        "weight",
        [fn("SUM", col("OrderItem.quantity")), "unitsSold"],
        [fn("SUM", literal(`"OrderItem"."price" * "OrderItem"."quantity"`)), "revenue"],
      ],
      include: [
        { model: Product, attributes: ["name"], required: true },
        { model: Order, attributes: [], where: orderWhere, required: true },
      ],
      where: { productId: { [Op.ne]: null } },
      group: [dayBucket, "OrderItem.productId", "OrderItem.weight", "Product.id"],
      order: [[dayBucket, "ASC"]],
      subQuery: false,
    }),
  ]);

  // Grouped one step further by weight (pack size, e.g. "250g"/"1kg") than
  // the product itself — so a product sold in two different pack sizes on
  // the same day comes back as one product entry with a nested `variants`
  // breakdown, same shape getSalesByProduct uses, rather than as two
  // separate top-level product rows (which would double-count the product
  // in the per-day list for no useful reason).
  const productsByDate = new Map(); // date -> Map(productId -> product entry)
  for (const row of productRows) {
    const date = row.get("date");
    const productMap = productsByDate.get(date) || new Map();
    const unitsSold = Number(row.get("unitsSold"));
    const revenue = Number(row.get("revenue"));
    const existing = productMap.get(row.productId) || {
      productId: row.productId,
      name: row.Product?.name || "Unknown product",
      unitsSold: 0,
      revenue: 0,
      variants: [],
    };
    existing.unitsSold += unitsSold;
    existing.revenue += revenue;
    existing.variants.push({ weight: row.weight || "Unspecified", unitsSold, revenue });
    productMap.set(row.productId, existing);
    productsByDate.set(date, productMap);
  }

  const days = dailyTotals.map((row) => ({
    date: row.date,
    revenue: Number(row.revenue),
    orderCount: Number(row.orderCount),
    products: productsByDate.has(row.date) ? Array.from(productsByDate.get(row.date).values()) : [],
  }));

  return sendSuccess(res, { range: { start, end }, days });
});
