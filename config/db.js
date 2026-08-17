const { Sequelize } = require("sequelize");

// Render's managed Postgres requires SSL for connections that reach it from
// outside its internal network — both Render's own production dyno and a
// local machine running a script (e.g. `npm run seed:admin`) against the
// production DATABASE_URL need it. NODE_ENV === "production" is the
// authoritative signal for the former (guaranteed set on Render, unlike
// trying to pattern-match Render's internal hostname); the DATABASE_URL
// host check covers the latter, where NODE_ENV is still "development"
// locally. A real local Postgres instance matches neither, so it stays
// SSL-free.
const needsSsl =
  process.env.NODE_ENV === "production" ||
  (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL));

const sslDialectOptions = needsSsl
  ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
  : {};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: "postgres",
      logging: false,
      ...sslDialectOptions,
    })
  : new Sequelize(process.env.PGDATABASE, process.env.PGUSER, process.env.PGPASSWORD, {
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      dialect: "postgres",
      logging: false,
      ...sslDialectOptions,
    });

const connectDB = async () => {
  await sequelize.authenticate();
  console.log("PostgreSQL Connected");
};

module.exports = { sequelize, connectDB };
