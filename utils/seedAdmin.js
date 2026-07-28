require("dotenv").config();
const bcrypt = require("bcryptjs");
const { sequelize, Admin } = require("../models");

async function seedAdmin() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();

    const existingCount = await Admin.count();
    if (existingCount > 0) {
      console.log("An admin already exists. Skipping seed (single super-admin design).");
      process.exit(0);
    }

    const name = process.env.SEED_ADMIN_NAME || "Sehat Potli Admin";
    const email = process.env.SEED_ADMIN_EMAIL || "admin@sehatpotli.com";
    const mobile = process.env.SEED_ADMIN_MOBILE || "9876543210";
    const password = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";

    const hashedPassword = await bcrypt.hash(password, 10);

    await Admin.create({ name, email, mobile, password: hashedPassword });

    console.log(`Super admin created successfully: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to seed admin:", err);
    process.exit(1);
  }
}

seedAdmin();
