# VÉLORA architecture

## Shape: a modular monolith

```
Browser (Next.js) ──/api/v1/* proxy──┐
Mobile (Expo) ───────────────────────┼──▶ NestJS API ──▶ MySQL
Admin / Vendor portal ───────────────┘         │         Redis (cache, jobs) · Meilisearch · Cloudinary
                                               └──▶ Paystack / Hubtel (webhooks verified server-side)
```

- Each feature lives in its own module under `apps/api/src/modules/<name>`. Modules talk to each other only through exported services, so a high-demand module can later move into its own service without a rewrite.
- `packages/shared` holds the single list of roles and permissions. The API enforces it, and the clients use it only to decide which controls to show.
- Every response uses the same envelope: `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details? } }`. Validation errors list each field and its messages.
- The API is versioned in the URI (`/api/v1`). Swagger documentation is served at `/api/docs` outside production.

## Authentication and sessions

| Item | Detail |
|---|---|
| Access token | HS256 JWT. It lives 15 minutes and is kept in memory on the web. |
| Refresh token | An opaque random string stored as a SHA-256 hash. It rotates on every use, and replaying an old one revokes the whole token family. |
| Web | The refresh token is sent as an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. Next.js proxies `/api/v1`, so the cookie is first-party. |
| Mobile | Sends `X-Velora-Client: mobile` and keeps the refresh token in SecureStore. |
| Lockout | Five failed attempts lock the account for 15 minutes. Every attempt is written to `login_activities`. |

## Data rules

- Primary keys are integers. Money is `DECIMAL(12,2)` alongside a currency code, with GHS as the default.
- Orders and order items keep their own copies of names, prices and addresses, so order history never changes.
- Inventory is tracked per variant per warehouse. Every change appends a row to the `stock_movements` ledger in the same transaction.
- Orders carry an `idempotency_key`, payments a unique `reference`, and webhook events a unique `(provider, event_id)`. Together they prevent duplicate orders and duplicate payment processing.

## Roadmap

1. **Foundation** ✅
2. **Customer website** ✅
3. **Administration** ✅
4. **Payments, delivery and returns** ✅
5. **Marketplace:** vendor onboarding, vendor portal, commissions, settlements
6. **Advanced:** recommendations, loyalty, promotions and flash sales, Meilisearch, notifications, analytics
7. **Mobile:** Expo app for Android and iOS with push notifications
8. **Testing and deployment:** load and security testing, Docker images, backups, monitoring
