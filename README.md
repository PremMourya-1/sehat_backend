# Sehat Potli Backend

REST API for **Sehat Potli** — a premium Dry Fruits & Nuts e-commerce brand
("Sehat Ki Potli, Har Ghar Ki Zaroorat"). Powers both `sehat-potli-front`
(storefront) and `sehat-potli-admin` (admin panel).

Stack: Node.js + Express 4 + Sequelize 6 + PostgreSQL, cookie-based JWT auth,
Multer local disk uploads, Resend for OTP emails.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a PostgreSQL database**

   ```sql
   CREATE DATABASE sehat_potli_backend;
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in real values:

   ```bash
   cp .env.example .env
   ```

   Key variables:
   - `DATABASE_URL` (or the discrete `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` vars)
   - `JWT_SECRET`, `JWT_EXPIRES_IN`
   - `STORE_FRONT_URL`, `STORE_FRONT_URL2`, `STORE_ADMIN_URL` (CORS allow-list)
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (customer OTP emails)
   - `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_MOBILE`, `SEED_ADMIN_PASSWORD`

4. **Run the dev server**

   ```bash
   npm run dev
   ```

   On boot the server connects to Postgres, runs `sequelize.sync({ alter: true })`
   to create/update tables, and seeds the default CMS pages
   (terms-and-conditions, privacy-policy, refund-policy).

5. **Seed the super admin** (one-time; only path to create an admin account —
   there is no admin registration endpoint)

   ```bash
   npm run seed:admin
   ```

6. **Seed the product catalog** (10 categories + sample products with
   weight-based variants — safe to re-run, skips existing products)

   ```bash
   npm run seed:catalog
   ```

## Scripts

| Script                | Description                                   |
| --------------------- | ---------------------------------------------- |
| `npm start`           | Start the server (production)                  |
| `npm run dev`         | Start the server with nodemon (development)     |
| `npm run seed:admin`  | Create the one and only super-admin account     |
| `npm run seed:catalog`| Seed categories + sample products with variants |
| `npm run lint`        | Run ESLint                                      |

## Notable domain differences from a typical catalog

Unlike a flat product-price model, Sehat Potli products are sold in multiple
**weight variants** (`250g` / `500g` / `1kg`), each with its own `price`,
`mrp`, and `stock` — see `models/ProductVariant.js`. Cart items and order
line items reference a specific `variantId` (with a `weight` snapshot on
orders so historical orders remain accurate even if a variant is later
removed).

Product `tags` are restricted to a fixed badge set: `100% Natural`,
`Rich in Nutrition`, `Premium Quality`, `Healthy Lifestyle` — enforced both
at the model validation level and in the admin product controller.

## API surface

- Public: `/api/auth`, `/api/products`, `/api/categories`, `/api/cart`
  (customer-guarded), `/api/orders` (customer-guarded), `/api/hero-banners`,
  `/api/coupons` (apply only), `/api/testimonials`, `/api/cms`.
- Admin: everything under `/api/admin/*`, behind `adminAuth` (except
  `/api/admin/login`).

All responses follow the envelope `{ action: boolean, message: string, data? }`.
