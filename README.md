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
| Customers | `adwoa.nkansah@example.test` and others |

## Tests

```bash
npm run test:api   # creates and migrates the velora_test database, seeds it, then runs the e2e suite
```

## Security notes

- Never commit `.env` files. Only the `.env.example` templates are tracked.
- Give production its own database user rather than root, a long random `JWT_ACCESS_SECRET`, and `COOKIE_SECURE=true` behind HTTPS.
- Never run the seed against production. It refuses to run when `NODE_ENV=production`.
