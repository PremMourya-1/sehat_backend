const { Op } = require("sequelize");
const { Order } = require("../models");

const ABANDONED_PAYMENT_HOURS = 24;
// This project has no cron/scheduled-task infrastructure (see
// controllers/adminCartController.js's own note on the same gap, which
// deliberately stayed a manual admin action instead) — a plain setInterval
// started once at boot is simple enough for an hourly check against a 24h
// threshold; nothing here is time-sensitive to the minute, so no need for a
// real scheduler library.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// A prepaid order that never completes payment sits at customerStatus
// "payment_pending" indefinitely otherwise (see controllers/
// orderController.js createOrder / utils/markOrderPaid.js for where that
// state comes from and how it resolves on success). Nothing was ever
// decremented or charged for one of these — stock only decrements once
// payment actually succeeds — so there's nothing to restock or refund;
// this just flips it to the terminal "payment_failed" state so it stops
// looking like a live, actionable order. Deliberately NOT routed through
// utils/orderCancellation.js's finalizeCancellation() — that restocks and
// (for a paid order) refunds, neither of which applies to an order that
// was never actually paid for.
async function cleanupAbandonedPaymentPendingOrders() {
  const cutoff = new Date(Date.now() - ABANDONED_PAYMENT_HOURS * 60 * 60 * 1000);
  const [count] = await Order.update(
    { customerStatus: "payment_failed", paymentStatus: "failed" },
    {
      where: {
        customerStatus: "payment_pending",
        paymentStatus: { [Op.ne]: "paid" },
        createdAt: { [Op.lt]: cutoff },
      },
    },
  );
  if (count > 0) {
    console.log(`Abandoned order cleanup: marked ${count} unpaid prepaid order(s) as payment_failed`);
  }
  return count;
}

// Called once at boot (see index.js) — runs an immediate pass, then every
// CHECK_INTERVAL_MS after that for as long as the process lives.
function startAbandonedOrderCleanupJob() {
  const run = () =>
    cleanupAbandonedPaymentPendingOrders().catch((err) =>
      console.error(`Abandoned order cleanup failed: ${err.message}`),
    );

  run();
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = { startAbandonedOrderCleanupJob, cleanupAbandonedPaymentPendingOrders };
