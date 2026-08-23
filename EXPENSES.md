# Expenses Tracker

A small, completely separate mini-app inside the same backend + admin
frontend repos, for Shinu and Komal to log household/business purchases.
It does **not** touch the existing admin auth, admin routes, or any
existing model — see the isolation notes below.

## What it is

- Backend: `models/Expense.js`, `middleware/expensesAuth.js`,
  `controllers/expensesAuthController.js`, `controllers/expensesController.js`,
  `routes/expensesRoutes.js`, mounted at `/api/expenses` in `index.js`.
- Frontend (admin panel repo, `sehat-potli-admin`): `src/Pages/Expenses/`,
  `src/Service/expensesApi.js`, `src/Routes/ExpensesProtectedRoute.jsx`,
  wired into `src/Routes/Route.jsx` as two sibling routes:
  - `/expenses/login`
  - `/expenses`
  Deliberately **not** listed in the admin sidebar (`Data/AdminData/*`) —
  reach it by typing the URL directly.

## Isolation from the admin panel

- **Different JWT secret.** `EXPENSES_JWT_SECRET` (backend `.env`), never
  the admin/customer `JWT_SECRET`. A token issued for one system will not
  verify against the other.
- **Different middleware.** `middleware/expensesAuth.js` is only ever
  mounted on `/api/expenses/*` — `middleware/adminAuth.js` is untouched
  and still only guards `/api/admin/*`.
- **Different frontend storage keys.** The token lives in
  `localStorage.expensesToken` / `localStorage.expensesUser` — completely
  separate from the admin panel's `ADMIN_DETAILS` key, so logging in/out
  of one never affects the other, even in the same browser.
- **Different axios client.** `src/Service/expensesApi.js` is its own
  axios instance (own base URL, own interceptor reading `expensesToken`)
  — it does not reuse `src/Service/service.js`'s `apiJson`/`apiMultipart`,
  which are scoped to `/api/admin` and inject the admin token.
- **No shared model relations.** `Expense` has no `belongsTo`/`hasMany`
  association with `Order`, `Product`, `Admin`, or anything else — see
  `models/index.js`, where it's just registered with no association
  lines.

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
| `EXPENSES_JWT_SECRET` | Yes | Long random string, different from `JWT_SECRET`. |
| `EXPENSES_PASSWORD` | Only for first-ever login | One-time seed value — see above. Ignored once the DB row exists. |

Both are documented with placeholders in `.env.example`.

## API

All routes below `/api/expenses` except `/login` require
`Authorization: Bearer <token>` (no cookie — Authorization header only).

- `POST /api/expenses/login` — `{ name: "shinu" | "komal", password }` → `{ token, name }` (30-day expiry).
- `GET /api/expenses?addedBy=shinu|komal|all&startDate=&endDate=` → `{ expenses, total, count }`, sorted by `purchaseDate` DESC then `createdAt` DESC.
- `POST /api/expenses` — `{ itemName, purchasePrice, purchaseDate?, notes? }`. `addedBy` always comes from the verified JWT, **never** from the request body — see `controllers/expensesController.js createExpense`.
- `PATCH /api/expenses/:id` — any of `itemName, purchasePrice, purchaseDate, notes`. Either user can edit either person's entry (shared household record); `addedBy` itself is never changed by an edit.
- `DELETE /api/expenses/:id` — same shared-record rule as edit.

## Data model

`Expense` (table `Expenses`): `id` (UUID), `itemName`, `purchasePrice`
(DECIMAL 10,2), `purchaseDate` (DATEONLY, defaults to today),
`addedBy` (ENUM `shinu`/`komal`), `notes` (nullable), `createdAt`/`updatedAt`.

No migration file — this project uses `sequelize.sync({ alter: true })` on
local dev startup (see `index.js`), which creates the table automatically.
On Render, the same sync runs on the next deploy after this code ships
(Render always runs in normal, non-`DB_MODE=live` mode).
