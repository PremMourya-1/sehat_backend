// One-off repair script — sequelize.sync({ alter: true }) silently failed to
// add the columns introduced by the pickup-scheduling and label/customerStatus
// phases of models/Order.js (confirmed via a direct information_schema query:
// the live Orders table was missing all 10 new columns despite "Database
// synced" logging successfully on every restart since). This applies the
// exact DDL sync should have run, matching the naming/nullability convention
// of the columns it did apply correctly (see existing enum_Orders_* types).
// Safe to run once; re-running after success will error since the columns
// will already exist (each statement is intentionally not IF-NOT-EXISTS
// guarded, so a partial re-run can't silently no-op and hide a real problem).
require("dotenv").config();
const { sequelize } = require("../config/db");

const STATEMENTS = [
  `CREATE TYPE "enum_Orders_customerStatus" AS ENUM ('confirmed','dispatched','picked_up','in_transit','out_for_delivery','delivered')`,
  `ALTER TABLE "Orders" ADD COLUMN "customerStatus" "enum_Orders_customerStatus" DEFAULT 'confirmed'`,

  `CREATE TYPE "enum_Orders_pickupStatus" AS ENUM ('not_scheduled','scheduled','failed','cancelled')`,
  `ALTER TABLE "Orders" ADD COLUMN "pickupStatus" "enum_Orders_pickupStatus" DEFAULT 'not_scheduled'`,
  `ALTER TABLE "Orders" ADD COLUMN "pickupScheduledAt" TIMESTAMPTZ`,
  `ALTER TABLE "Orders" ADD COLUMN "pickupDate" TIMESTAMPTZ`,
  `ALTER TABLE "Orders" ADD COLUMN "lastPickupError" TEXT`,

  `CREATE TYPE "enum_Orders_labelStatus" AS ENUM ('not_generated','generated','failed')`,
  `ALTER TABLE "Orders" ADD COLUMN "labelStatus" "enum_Orders_labelStatus" DEFAULT 'not_generated'`,
  `ALTER TABLE "Orders" ADD COLUMN "labelUrl" VARCHAR(255)`,
  `ALTER TABLE "Orders" ADD COLUMN "labelGeneratedAt" TIMESTAMPTZ`,
  `ALTER TABLE "Orders" ADD COLUMN "lastLabelError" TEXT`,

  `ALTER TABLE "Orders" ADD COLUMN "emailsSent" JSONB DEFAULT '{"confirmed":false,"packed":false,"outForDelivery":false,"delivered":false}'::jsonb`,
];

(async () => {
  const t = await sequelize.transaction();
  try {
    await sequelize.authenticate();
    for (const sql of STATEMENTS) {
      console.log(`Running: ${sql}`);
      await sequelize.query(sql, { transaction: t });
    }
    await t.commit();
    console.log("All missing Order columns added successfully.");
  } catch (err) {
    await t.rollback();
    console.error("Failed — rolled back:", err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
