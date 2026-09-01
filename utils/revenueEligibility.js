const { Op } = require("sequelize");

// An order counts as having generated real revenue only if it's not
// cancelled and not stuck in a legacy pre-AbandonedCheckout payment-pending
// state (payment_pending/payment_failed — see models/Order.js's own
// comment: no new order can reach these anymore, but a historical row
// still could carry one). Originally defined only inside
// adminAnalyticsController.js; pulled out here once a second controller
// (adminSalesReportController.js) needed the exact same rule — so "what
// counts as revenue" can never quietly drift between the two.
const REVENUE_EXCLUDED_CUSTOMER_STATUSES = ["cancelled", "payment_pending", "payment_failed"];
const REVENUE_ELIGIBLE = { customerStatus: { [Op.notIn]: REVENUE_EXCLUDED_CUSTOMER_STATUSES } };

module.exports = { REVENUE_ELIGIBLE, REVENUE_EXCLUDED_CUSTOMER_STATUSES };
