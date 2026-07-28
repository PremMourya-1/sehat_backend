const { Customer, Order, sequelize } = require("../models");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response");

// GET /api/admin/customers — read-only, includes order count per customer
exports.getAllCustomers = asyncHandler(async (req, res) => {
  const customers = await Customer.findAll({
    attributes: [
      "id",
      "name",
      "email",
      "mobile",
      "isVerified",
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
    attributes: ["id", "name", "email", "mobile", "isVerified", "createdAt"],
  });
  if (!customer) return sendError(res, "Customer not found", 404);

  const orderCount = await Order.count({ where: { customerId: customer.id } });

  return sendSuccess(res, { ...customer.toJSON(), orderCount });
});
