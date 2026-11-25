# VÉLORA

**Where Elegance Meets Expression. DEFINE YOUR STYLE.**

A fashion, beauty and lifestyle marketplace for Ghana, built to grow internationally. It sells platform-owned stock alongside products from external vendors.

| App | Path | Stack |
|---|---|---|
| Backend API | `apps/api` | NestJS 11, TypeScript, Prisma 6, MySQL 8 / MariaDB 10.4+ |
| Customer website | `apps/web` | Next.js 15 (App Router), Tailwind CSS 4, TanStack Query, Zustand |
| Shared types and permissions | `packages/shared` | TypeScript |
| Mobile app | `apps/mobile` | React Native and Expo (Phase 7) |

## Status

**Phase 1: Foundation** is complete:

- A full relational schema with 60+ tables covering identity, catalogue, inventory, orders, payments, shipping, marketing, vendors and audit. It has an initial migration and idempotent seed data.
- Authentication:
  - argon2id password hashing
  - 15-minute access JWTs
  - Rotating refresh tokens with reuse detection
  - Account lockout
  - Login-activity log
  - Password reset
  - Sign out of all devices
- RBAC with 11 roles and 48 permissions, enforced on the server by global guards. Permissions are reloaded on every request, so role changes and suspensions apply immediately.
- Security:
  - helmet
  - Rate limiting
  - Strict input validation that blocks mass-assignment
  - CSRF protection for the cookie endpoints (client header, Origin allowlist, SameSite=Strict)
  - Audit log with secrets redacted
- Website pages: design system, sign-in, registration, forgot and reset password, and a protected account page.
- 23 end-to-end API tests.

**Phase 2: Customer website** is complete:

- **Catalogue:**
  - Department, shop-all, sale and search pages, rendered on the server
  - URL-based filters: size, colour, brand, price, rating, stock, sale
  - Sorting, pagination and quick view
- **Product page:**
  - Colourway gallery with hover zoom
  - Stock per variant, size guides, delivery estimates
  - Reviews with rating filters and fit summary, Q&A
  - "Wear it with" and "Similar pieces" rails
- **Search:** autocomplete, trending searches, recently viewed and personalised recommendations.
- **Bag:** works for guests and members (merged at sign-in), with stock limits and promo codes.
- **Checkout:**
  - Four steps for guests or members
  - Delivery fees by Ghana region, including free-delivery thresholds
  - Cash or MoMo on delivery
  - Totals calculated on the server
  - Idempotent order placement and stock reservation under row locks, so stock is never oversold
- **Account:** overview with loyalty points, profile, orders with cancellation, saved addresses and wishlist. Guests can track orders.
- 39 end-to-end API tests, including a race for the last unit in stock.

**Phase 3: Administration** is complete. The admin area is at `/admin`; sign in with a staff account.

- **Access:** the sidebar shows only the areas each role can use, and every endpoint checks the same permissions on the server.
- **Notification centre:** counts of orders to fulfil, low-stock variants and items awaiting review.
- **Dashboard:**
  - KPIs (revenue, orders, average order value, customers) compared with the previous period
  - Fulfilment counts and daily revenue chart
  - Best sellers, top departments, recent orders and inventory alerts
  - Filters by date, department and channel
- **Reports:** sales by day, week or month, with CSV export (protected against spreadsheet formula injection).
- **Products:**
  - Create and edit with a variant matrix and opening stock per warehouse
  - Image upload (content-checked, 5 MB limit) and attributes
  - Publish, archive or delete; approve or reject vendor products
  - CSV import with a dry-run check, and CSV export
- **Categories and brands:** manage the tree (reorder, no cycles, guarded delete) and brands.
- **Orders:**
  - Search and filters
  - Dispatch: the stock reservation becomes a sale, and the shipment gets tracking
  - Mark delivered: cash-on-delivery payment, sales counts, loyalty points, and vendor earnings start their hold period
  - Staff cancellation, notes, tracking updates, printable invoice and packing slip
- **Inventory:**
  - Stock levels per warehouse
  - Adjustments, which can never go below stock reserved for orders
  - Reorder levels, movement ledger, valuation at cost and retail
  - Two-step transfers, suppliers, purchase orders with partial goods receipts and weighted-average cost
- **Customers:** segments (VIP, Loyal, New, At risk, Prospect, Regular), profile, lifetime value, and suspension.
- **Staff:** create staff accounts, assign roles, suspend accounts, and browse the audit log.
- 62 end-to-end API tests.

**Phase 4: Payments, delivery and returns** is complete.

- **Online payments:** Paystack (cards, MTN MoMo, Telecel Cash, AT Money) and Hubtel. Each is offered at checkout only when its keys are set in `apps/api/.env`.
- **Payment confirmation:** an order is marked paid only after a server-side check. Paystack confirms through an HMAC-SHA512-signed webhook or its verify API; Hubtel through its status API. Amount and currency must match, each payment is applied exactly once, and webhook events are de-duplicated.
- **Unpaid orders:** stock is held for `PAYMENT_TTL_MINUTES`, and the shopper can retry a failed payment. A background job re-checks the provider, then cancels the order and releases its stock. A payment that arrives after cancellation automatically becomes a refund request.
- **Returns and exchanges:** customers request them within the return window. Staff approve, then receive items (resellable items are restocked). Settlement is either a refund for exactly what was paid, or a free replacement order for an exchange.
- **Refunds:** Finance refunds through the original provider or records a manual MoMo or bank payout. Order totals, the vendor commission and loyalty points are adjusted to match.
- **Admin screens:** a payments ledger, the provider webhook log, a returns queue and a refunds queue.
- **Development simulator:** with `PAYMENT_SIMULATOR=true` (development only; the API refuses to start with it in production), a test checkout runs the whole online-payment flow without keys.
- 70 end-to-end API tests.

**Going live with Paystack:**
1. Set `PAYSTACK_SECRET_KEY` (`sk_live_…`).
2. In the Paystack dashboard, set the webhook URL to `<API_PUBLIC_URL>/api/v1/payments/webhooks/paystack`.
3. Set `PAYMENT_SIMULATOR=false`.

**Going live with Hubtel:**
1. Set `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET` and `HUBTEL_MERCHANT_ACCOUNT`.
2. Make sure `API_PUBLIC_URL` is reachable from the internet so Hubtel's callback can arrive.

**Phase 5: Marketplace** is complete.

- **Onboarding:** shoppers apply at `/sell`. Staff review the application at `/admin/vendor-applications`. Approval creates, in one transaction, the shop, its own stock location (`VND-<id>`) and the seller's portal access, and notifies the seller.
- **Vendor portal** (`/vendor`):
  - a dashboard;
  - products, which are always reviewed by VÉLORA before going on sale, and an edit to a live product sends it back for review;
  - inventory for the seller's own location;
  - orders, showing only the seller's lines and the delivery city, with no customer contact details;
  - earnings, statements and a sales report with CSV export;
  - reviews, payout details and in-app notifications.
- **Isolation:** every portal query is scoped by the vendor ID on the signed-in user, never by a request parameter. Another shop's records return 404.
- **Commissions and settlements:**
  - Each sale records the commission at the vendor's current rate.
  - Earnings are held until the order is delivered and the return window closes; refunds and cancellations reverse them.
  - Finance generates statements at `/admin/settlements`, approves them, pays, and records the transfer reference. A sale can only appear on one statement.
  - Payment is refused until the vendor has added payout details.
- **Vendor management:** per-vendor stats, commission changes (new orders only), and suspension, which hides the shop's products and locks the portal immediately.
- **Shop pages:** each vendor has a public page at `/v/<slug>`, linked from "Sold by" on product pages.
- 78 end-to-end API tests, including vendor-isolation tests.

The remaining phases are listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Running locally

**Requirements:**

- Node.js 20.11 or later (developed on Node 24)
- MySQL 8 or MariaDB 10.4+. XAMPP works, or run `docker compose up -d mysql`.

```bash
npm install
npm run build:shared

# API configuration
cp apps/api/.env.example apps/api/.env     # then set DATABASE_URL and a random JWT_ACCESS_SECRET
cp apps/web/.env.example apps/web/.env.local

# Database: create the schema and load demo data
cd apps/api
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
cd ../..

# Start the API and the website, each in its own terminal
npm run dev:api     # http://localhost:4000/api/v1   (Swagger docs: http://localhost:4000/api/docs)
npm run dev:web     # http://localhost:3000
```

> npm 11 skips dependency install scripts by default, so run `npx prisma generate` yourself after every install.

**Demo accounts (development only).** Passwords come from `SEED_SUPER_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` in `apps/api/.env`.

| Role | Email |
|---|---|
| Super Administrator | `admin@velora.test` |
| Staff, one account per role | `admin@`, `product-manager@`, `inventory-manager@`, `order-manager@`, `finance-officer@`, `customer-support@`, `marketing-manager@` and `warehouse-officer@` at `staff.velora.test` |
| Vendor (Adinkra Atelier) | `vendor@velora.test` |
| Seller applicant (application pending) | `applicant@velora.test` |
| Customers | `adwoa.nkansah@example.test` and others |

## Tests

```bash
npm run test:api   # creates and migrates the velora_test database, seeds it, then runs the e2e suite
```

## Security notes

- Never commit `.env` files. Only the `.env.example` templates are tracked.
- Give production its own database user rather than root, a long random `JWT_ACCESS_SECRET`, and `COOKIE_SECURE=true` behind HTTPS.
- Never run the seed against production. It refuses to run when `NODE_ENV=production`.
