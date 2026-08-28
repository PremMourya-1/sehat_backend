const { Op } = require("sequelize");
const { AbandonedCheckout } = require("../models");

const EXPIRY_HOURS = 24;
// This project has no cron/scheduled-task infrastructure (see
// controllers/adminCartController.js's own note on the same gap) — a plain
// setInterval started once at boot is simple enough for an hourly check
// against a 24h threshold.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// AbandonedCheckout rows are never deleted by this — only marked "expired"
// (see models/AbandonedCheckout.js: no "converted" status exists because a
// converted checkout is deleted outright by
// utils/convertAbandonedCheckout.js, not relabeled). Kept around after
// expiry on purpose — useful for future remarketing (customer contact info
// + exactly what they were trying to buy is right there), and the admin
// "Abandoned Checkouts" page needs to be able to tell "might still
// complete" (pending) apart from "gave up" (expired).
async function expireAbandonedCheckouts() {
  const cutoff = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1000);
  const [count] = await AbandonedCheckout.update(
    { status: "expired" },
    { where: { status: "pending", createdAt: { [Op.lt]: cutoff } } },
  );
  if (count > 0) {
    console.log(`Abandoned checkout cleanup: marked ${count} checkout(s) expired`);
  }
  return count;
}

// Called once at boot (see index.js) — runs an immediate pass, then every
// CHECK_INTERVAL_MS after that for as long as the process lives.
function startAbandonedCheckoutCleanupJob() {
  const run = () =>
    expireAbandonedCheckouts().catch((err) => console.error(`Abandoned checkout cleanup failed: ${err.message}`));

  run();
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = { startAbandonedCheckoutCleanupJob, expireAbandonedCheckouts };
