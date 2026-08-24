# Finance (Expenses + Sales)

A small, completely separate mini-app inside the same backend + admin
frontend repos, for Shinu and Komal to log household/business purchases
(Expenses) and offline sales made outside the normal online store (Sales).
It does **not** touch the existing admin auth, admin routes, or any
existing model — see the isolation notes below.

Originally shipped as "Expenses Tracker" at `/expenses`; renamed/expanded
to "Finance" with two resources under `/finance/*` once the Sales feature
was added. Both resources share one login — there's still only one
password and one JWT.

## What it is

- Backend: `models/Expense.js`, `models/Sale.js`, `middleware/expensesAuth.js`,
  `controllers/expensesAuthController.js`, `controllers/expensesController.js`,
  `controllers/salesController.js`, `routes/expensesRoutes.js`,
  `routes/salesRoutes.js`, mounted at `/api/expenses` and `/api/sales` in
  `index.js`. There is no separate `/api/sales/login` — Sales reuses the
  exact same `expensesAuth` middleware and the same `POST /api/expenses/login`.
- Frontend (admin panel repo, `sehat-potli-admin`): `src/Pages/Finance/`,
  `src/Service/financeApi.js`, `src/Routes/FinanceProtectedRoute.jsx`,
  wired into `src/Routes/Route.jsx` as three sibling routes:
  - `/finance/login`
  - `/finance/expenses`
  - `/finance/sales`
  Deliberately **not** listed in the admin sidebar (`Data/AdminData/*`) —
  reach it by typing the URL directly.

## Isolation from the admin panel

- **Different JWT secret.** `EXPENSES_JWT_SECRET` (backend `.env`), never
  the admin/customer `JWT_SECRET`. A token issued for one system will not
  verify against the other. (Kept the `EXPENSES_` prefix on the env var
  name even after the Finance rename, to avoid an unnecessary env change
  on Render.)
- **Different middleware.** `middleware/expensesAuth.js` is only ever
  mounted on `/api/expenses/*` and `/api/sales/*` — `middleware/adminAuth.js`
  is untouched and still only guards `/api/admin/*`.
- **Different frontend storage keys.** The token lives in
  `localStorage.financeToken` / `localStorage.financeUser` — completely
  separate from the admin panel's `ADMIN_DETAILS` key, so logging in/out
  of one never affects the other, even in the same browser.
- **Different axios client.** `src/Service/financeApi.js` is its own
  axios instance (own base URL, own interceptor reading `financeToken`)
  — it does not reuse `src/Service/service.js`'s `apiJson`/`apiMultipart`,
  which are scoped to `/api/admin` and inject the admin token.
- **No shared model relations.** Neither `Expense` nor `Sale` has a
  `belongsTo`/`hasMany` association with `Order`, `Product`, `Admin`, or
  anything else — see `models/index.js`, where both are just registered
  with no association lines.

## Where the shared login password lives

Both Shinu and Komal log in with the **same shared password** (their name
picks whose entries get attributed, not a personal account). Same
DB-first, `.env`-fallback pattern already used for Shiprocket credentials
(`utils/shiprocket.js getCredentials()`):

1. On first login attempt ever, if no `IntegrationSetting` row with
   `integrationKey: "expenses"` exists yet, the password is read from
   `EXPENSES_PASSWORD` in `.env`, encrypted (`utils/encryption.js`, same
   AES-256-GCM scheme as every other integration secret), and saved into
   that row.
2. Every login after that reads the encrypted password from the DB —
   `.env`'s `EXPENSES_PASSWORD` is ignored from then on.

### To change the password later (no redeploy needed)

Update the `config.password` field on the `IntegrationSettings` row where
`integrationKey = 'expenses'`, storing it through `utils/encryption.js`'s
`encrypt()` — e.g. from a one-off Node script run against the target
database:

```js
require("dotenv").config();
const { IntegrationSetting } = require("./models");
const { encrypt } = require("./utils/encryption");

(async () => {
  const encrypted = encrypt("the-new-shared-password");
  await IntegrationSetting.upsert({
    integrationKey: "expenses",
    config: { password: encrypted },
  });
})();
```

There's no admin-panel UI for this yet (out of scope for this feature) —
this is a manual, occasional operation.

## Env vars (backend)

| Var | Required | Notes |
|---|---|---|
| `EXPENSES_JWT_SECRET` | Yes | Long random string, different from `JWT_SECRET`. Shared by both Expenses and Sales tokens. |
| `EXPENSES_PASSWORD` | Only for first-ever login | One-time seed value — see above. Ignored once the DB row exists. |

Both are documented with placeholders in `.env.example`.

## API

All routes below `/api/expenses` and `/api/sales` except `/expenses/login`
require `Authorization: Bearer <token>` (no cookie — Authorization header
only).

### Expenses

- `POST /api/expenses/login` — `{ name: "shinu" | "komal", password }` → `{ token, name }` (30-day expiry). This is the one login for both Expenses and Sales.
- `GET /api/expenses?addedBy=shinu|komal|all&startDate=&endDate=` → `{ expenses, total, count }`, sorted by `purchaseDate` DESC then `createdAt` DESC.
- `POST /api/expenses` — `{ itemName, purchasePrice, purchaseDate?, notes? }`. `addedBy` always comes from the verified JWT, **never** from the request body — see `controllers/expensesController.js createExpense`.
- `PATCH /api/expenses/:id` — any of `itemName, purchasePrice, purchaseDate, notes`. Either user can edit either person's entry (shared household record); `addedBy` itself is never changed by an edit.
- `DELETE /api/expenses/:id` — same shared-record rule as edit.

### Sales (offline sales made outside the normal online store)

- `GET /api/sales?addedBy=shinu|komal|all&startDate=&endDate=` → `{ sales, total, count }`, sorted by `saleDate` DESC then `createdAt` DESC.
- `POST /api/sales` — `{ itemName, salePrice, saleDate?, notes? }`. `saleDate` is optional and defaults to today (unlike Expense's `purchaseDate`, which is required) — see `models/Sale.js`. `addedBy` always comes from the verified JWT, **never** from the request body.
- `PATCH /api/sales/:id` — any of `itemName, salePrice, saleDate, notes`. Either user can edit either person's entry.
- `DELETE /api/sales/:id` — same shared-record rule as edit.

## Data model

`Expense` (table `Expenses`): `id` (UUID), `itemName`, `purchasePrice`
(DECIMAL 10,2), `purchaseDate` (DATEONLY, required, defaults to today),
`addedBy` (ENUM `shinu`/`komal`), `notes` (nullable), `createdAt`/`updatedAt`.

`Sale` (table `Sales`): `id` (UUID), `itemName`, `salePrice`
(DECIMAL 10,2), `saleDate` (DATEONLY, optional, defaults to today),
`addedBy` (ENUM `shinu`/`komal`), `notes` (nullable), `createdAt`/`updatedAt`.

No migration file — this project uses `sequelize.sync({ alter: true })` on
local dev startup (see `index.js`), which creates each table automatically.
On Render, the same sync runs on the next deploy after this code ships
(Render always runs in normal, non-`DB_MODE=live` mode).
