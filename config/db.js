const { Sequelize } = require("sequelize");

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false })
  : new Sequelize(process.env.PGDATABASE, process.env.PGUSER, process.env.PGPASSWORD, {
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      dialect: "postgres",
      logging: false,
    });

const connectDB = async () => {
  await sequelize.authenticate();
  console.log("PostgreSQL Connected");
};

module.exports = { sequelize, connectDB };
