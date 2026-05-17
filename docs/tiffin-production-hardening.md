# Production Hardening & Launch Readiness

End-to-end production playbook for the tiffin platform. Everything below
runs on the existing stack — TanStack Start v1, React 19, Supabase,
Supabase Realtime — no Docker / K8s / external microservices.

---

## 1. Security Layer

### Auth & Roles
- Phone-OTP + email/password via Supabase Auth (no anonymous sign-ups).
- Roles in `public.user_roles` (separate table, never on `profiles`).
  `customer | rider | admin | super_admin`.
- `has_role(uid, role)` and `is_admin(uid)` are `SECURITY DEFINER` —
  used by every RLS policy and gated RPC. Prevents recursive-policy CVEs.
- Route protection:
  - `_authenticated` layout → redirect to `/login`.
  - `/admin/*` → `beforeLoad` checks `is_admin`.
  - `/super/*` → `beforeLoad` checks `has_role('super_admin')`.

### RLS Posture (verified)
- Every table has RLS enabled. User-owned tables (`orders`, `wallets`,
  `wallet_transactions`, `payments`, `notifications`,
  `support_tickets`, …) restrict by `auth.uid()`.
- Aggregates and admin actions go through `SECURITY DEFINER` RPCs
  (`admin_kpis`, `admin_verify_payment`, `kitchen_dispatch_batch`,
  `cancel_order_with_refund`, `super_overview`, …) gated by
  `is_admin(auth.uid())` / `has_role`.
- Wallet mutations are **server-only** — no table-level write policy lets
  customers touch `wallet_transactions`. Refunds and credits go through
  RPCs that take the row lock (`for update`) and write the ledger.
- `audit_log` is super-admin readable; admin actions insert audit rows
  (payment verification, rejections, dispatches).

### Input Validation
- Zod-validate every form on the client.
- Server functions called from the client use `.inputValidator()` with
  Zod (length caps, regex, numeric ranges).
- All RPCs raise typed exceptions (`'forbidden'`, `'cutoff_passed'`,
  `'insufficient_balance'`, `'invalid_otp'`, …) — front-end maps them
  to friendly toasts.

### OTP Abuse / Session
- `otp_requests` rate-limited at the OTP issue RPC (1 per phone per 30s,
  5/hour). Codes hashed (`code_hash`), `expires_at` enforced, attempts
  capped, single-use (`consumed_at`).
- `user_sessions` table records device label/UA/IP; `revoke_session`
  RPC supports remote logout.
- Cookies handled by Supabase Auth (httpOnly via SDK). No long-lived
  service-role keys ever shipped to the browser.

### Secrets
- `VITE_SUPABASE_*` are publishable. `SUPABASE_SERVICE_ROLE_KEY` only
  used inside `*.server.ts` modules behind `createServerFn` —
  never imported from a route loader or component.

> **Rate limiting**: We do not run app-layer rate limiting. The only
> bucketed limits live in `otp_requests` (per-phone) and Supabase Auth's
> built-in throttling. See `no-backend-rate-limiting` for context.

---

## 2. Error Handling

- **Route-level**: `__root.tsx` defines `errorComponent` + `notFoundComponent`.
- **App-level**: `<AppErrorBoundary/>` wraps the entire tree
  (`src/components/AppErrorBoundary.tsx`) — catches anything outside
  the route tree (toaster, providers). Forwards to
  `window.__lovable_error__` for monitoring shipping.
- **Async errors**:
  - All `useQuery` flows surface errors to UI; toast via `error.message`.
  - All RPC mutations wrap in try/catch and toast on failure.
  - Retry policy in QueryClient: skip 401/403/404, otherwise 2 retries
    with exponential backoff, capped at 8s.
- **Realtime errors** swallowed inside channel callbacks; the resilience
  hook reconnects on online/visibility change.

---

## 3. Realtime Stability

`src/hooks/use-realtime-resilience.ts` (mounted once in `__root`):

- On `online` and `visibilitychange → visible`, force
  `supabase.realtime.disconnect()` + `connect()`.
- Then `qc.invalidateQueries()` to reconcile any postgres_changes events
  missed while offline (Realtime is best-effort, not a guaranteed log).
- Per-page channels are named (`kitchen-rt-${date}`, `analytics-rt`,
  `tracking-${orderId}`) and removed on unmount — no leak.
- Rider tracking falls back to last-known coordinates + REST hydration
  if the channel is silent for >30s.

---

## 4. Performance

### React Query
- Production defaults: `staleTime 30s`, `gcTime 5min`,
  `refetchOnWindowFocus: false`, `refetchOnReconnect: 'always'`.
- All analytics keys namespaced (`["analytics", …]`) — one `invalidate`
  call covers them.

### Routing
- TanStack auto code-splitting (`autoCodeSplitting: true`).
- `defaultPreload: "intent"` — preloads on link hover.
- Components in route files are NOT exported (kept in split chunks).

### Database
- All admin RPCs are `STABLE` and `SECURITY DEFINER`, hitting indexed
  columns (`delivery_date`, `created_at`, `user_id`).
- For >50k orders/day, swap `admin_daily_series` and `admin_meal_mix`
  for materialized views refreshed via `pg_cron`.

### Mobile / PWA
- Viewport already set: `width=device-width, initial-scale=1, viewport-fit=cover`.
- `theme-color` declared.
- `manifest.webmanifest` linked from `__root`.
- No heavy maps library — live tracking uses a lightweight inline SVG
  pin, lazy-loads only when the customer opens `/app/track/$id`.

---

## 5. Monitoring & Logging

- Frontend → `window.__lovable_error__` hook (set by
  `AppErrorBoundary`). Wire to Lovable analytics or any beacon endpoint.
- Server → `console.error` inside `createServerFn` handlers shows up in
  worker logs (`stack_modern--server-function-logs`).
- DB → Supabase Postgres logs surface via `supabase--analytics_query`.
- `audit_log` captures admin write-actions (verifications, dispatches,
  refunds, role grants).

---

## 6. QA Checklist (manual, per release)

| Area      | Check |
|-----------|-------|
| Auth      | OTP issue → verify → session persists across reload. Logout revokes session row. |
| Wallet    | Add money → submit UTR → admin verify → balance updates in real time. |
| Order     | Place at cutoff − 1 min ✅, at cutoff + 1 min → `cutoff_passed`. Insufficient balance blocked. |
| Cancel    | Self-cancel before cutoff refunds. Admin-cancel any time refunds. |
| Kitchen   | Create batch → orders sweep in. Dispatch → orders move to OFD, deliveries created. |
| Track     | Live rider pin updates within 20s of heartbeat. OTP delivery succeeds; bad OTP rejected. |
| Admin     | Non-admin user receives `forbidden` from every admin RPC. |
| Super     | Non-super user blocked from `/super/*` and `super_overview`. |
| Realtime  | Toggle airplane mode → restore → orders & KPIs refresh within 2s. |
| Error UX  | Throw in a component → AppErrorBoundary fallback shown, "Try again" recovers. |
| Mobile    | iOS Safari install banner, viewport, safe-area insets render correctly. |

---

## 7. Launch Checklist

- [ ] Run `supabase--linter`; address every error-level finding.
- [ ] Run `security--run_security_scan`; resolve or document each
      finding (update `security--update_memory` for accepted risks).
- [ ] Verify `app_settings` populated for `cutoffs`, `pricing`,
      `rounds`, `upi`, `growth`.
- [ ] Seed at least one `super_admin` and one `admin` row in
      `user_roles`.
- [ ] Confirm `pg_cron` schedules: `lock_orders_past_cutoff`,
      `claim_pending_notifications`, `retention_scan`.
- [ ] WhatsApp dispatcher endpoint deployed with verified secret.
- [ ] PWA icons + `manifest.webmanifest` valid (Lighthouse PWA audit
      ≥ 90).
- [ ] Production env vars set (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] Smoke test the QA matrix above against the published URL.
- [ ] Enable HIBP password check (auth settings).
- [ ] Confirm `Auth → Email` rate limits set to sane values.
- [ ] Set custom domain + custom email sender, if applicable.

---

## 8. Scalability Path

- **Multi-city**: add `city_id` to `orders / riders / kitchen_batches`,
  scope every admin RPC and dashboard query by city. Use a router
  context value (`activeCity`) passed in headers.
- **Realtime fan-out at scale**: shard channels by city/meal
  (`kitchen-rt-${city}-${date}`) so one busy region doesn't push events
  to every admin.
- **Analytics volume**: introduce materialized views + `pg_cron`
  refreshes; switch the `useDailySeries` RPC body to a `select` from
  the MV — hooks unchanged.
- **Rider GPS**: throttle `rider_heartbeat` to 20s server-side; if
  fleet >100, move heartbeat to a single Realtime broadcast channel
  per rider instead of per-row updates.

---

## 9. Files Added in This Pass

- `src/router.tsx` — production QueryClient defaults + intent preload.
- `src/components/AppErrorBoundary.tsx` — top-level boundary with
  monitoring hook.
- `src/hooks/use-realtime-resilience.ts` — reconnect + reconcile.
- `src/routes/__root.tsx` — wired both into the React tree.

Everything else (RLS, RPCs, role checks, audit log, kitchen/dispatch,
analytics, notifications, support) was hardened in earlier passes —
this doc is the index of what's already production-grade.
