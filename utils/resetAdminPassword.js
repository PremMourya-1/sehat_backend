require("dotenv").config();
const bcrypt = require("bcryptjs");
const { sequelize, Admin } = require("../models");

// One-off utility for when the single super-admin (see seedAdmin.js —
// this project only ever has one) forgets their password. Never creates or
// duplicates an admin record — that's seedAdmin's job, and it already
// refuses to run once one exists. This only updates the existing row's
// password field, hashed the same way adminAuthController.js's login
// checks it (bcrypt, same cost factor as seedAdmin.js).
async function resetAdminPassword() {
  try {
    await sequelize.authenticate();

    const admin = await Admin.findOne({ order: [["createdAt", "ASC"]] });
    if (!admin) {
      console.error("No admin record exists yet — run `npm run seed:admin` to create the first one.");
      process.exit(1);
    }

    const newPassword = process.env.NEW_ADMIN_PASSWORD;
    if (!newPassword) {
      console.error("Set NEW_ADMIN_PASSWORD before running this script, e.g.:");
      console.error('  NEW_ADMIN_PASSWORD="YourNewPassword123" npm run reset:admin-password');
      process.exit(1);
    }

    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();

    console.log(`Admin password reset successfully for: ${admin.email}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to reset admin password:", err);
    process.exit(1);
  }
}

resetAdminPassword();
