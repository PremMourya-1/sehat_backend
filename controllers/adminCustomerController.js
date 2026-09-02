const { Customer, Order, ImpersonationLog, sequelize } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");
const generateToken = require("../utils/generateToken");

// Deliberately short — this ticket only needs to survive the instant it
// takes the admin panel to open a new tab and that tab's first request to
// reach sehat-potli-front's /api/impersonate route (see there), which
// exchanges it, server-side, for a real NextAuth customer session via
// /api/auth/adapter/verify-impersonation-token below. The resulting
// session then follows normal customer-session rules — narrowing this
// window is what actually matters for "a leaked/reused link", not
// artificially shortening the logged-in session that follows.
const IMPERSONATION_TICKET_TTL = "2m";

// GET /api/admin/customers — read-only, includes order count per customer
exports.getAllCustomers = asyncHandler(async (req, res) => {
  const customers = await Customer.findAll({
    attributes: [
      "id",
      "name",
      "email",
      "mobileNumber",
      "mobileVerified",
      "emailVerified",
      "createdAt",
      [sequelize.fn("COUNT", sequelize.col("Orders.id")), "orderCount"],
    ],
    include: [{ model: Order, attributes: [] }],
    group: ["Customer.id"],
    order: [["createdAt", "DESC"]],
  });

  return sendSuccess(res, customers);
});

// GET /api/admin/customers/:id
exports.getCustomerById = asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.params.id, {
    attributes: [
      "id",
      "name",
      "email",
      "mobileNumber",
      "mobileVerified",
      "emailVerified",
      "createdAt",
    ],
  });
  if (!customer) return sendError(res, "Customer not found", 404);

  const orderCount = await Order.count({ where: { customerId: customer.id } });

  return sendSuccess(res, { ...customer.toJSON(), orderCount });
});

// POST /api/admin/customers/:id/impersonate — "Login as Customer". Issues a
// short-lived, single-purpose ticket (never the customer's real API bearer
// token, never their password) that the storefront exchanges, server-side,
// for a genuine NextAuth customer session — see
// sehat-potli-front's src/auth.js "impersonation" Credentials provider and
// its /api/impersonate route handler. The admin panel opens that route in a
// new tab with this ticket, so the admin ends up looking at the storefront
// exactly as this customer would, without ever knowing their password.
//
// The audit row is written unconditionally, before the ticket is even
// generated — this stays traceable (which admin, which customer, when)
// regardless of whether the ticket ever actually gets used.
exports.impersonateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findByPk(req.params.id);
  if (!customer) return sendError(res, "Customer not found", 404);

  await ImpersonationLog.create({ adminId: req.admin.id, customerId: customer.id });

  const token = generateToken({ id: customer.id, type: "impersonation" }, IMPERSONATION_TICKET_TTL);
  return sendSuccess(res, { token });
});
