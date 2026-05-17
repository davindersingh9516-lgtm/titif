# Admin & Super Admin Implementation

Stack: TanStack Start v1 · React 19 · Supabase · Realtime · TypeScript · Vite 7

## Route map

```
/admin              — protected layout (role: admin | super_admin)
  ├─ /              admin.index — live KPI dashboard (orders, revenue, riders, alerts)
  ├─ /orders        live order monitoring, meal/round/status filters, cancel + refund
  ├─ /kitchen       prep board, batches, dispatch to riders
  ├─ /menu          menu items CRUD, daily meal toggle
  ├─ /riders        rider list, online status, perf, link-to-phone
  ├─ /customers     customer list, wallet balances, addresses
  ├─ /payments      UPI recharge verification queue (verify / reject)
  ├─ /support       support tickets, reply, resolve-with-refund
  └─ /growth        referrals, loyalty, ratings, retention scan

/super              — protected layout (role: super_admin)
  ├─ /              super.index — platform GMV, lifetime, wallet float
  ├─ /admins        admin/super-admin role management
  └─ /settings      cutoffs, pricing, rounds, UPI merchant
```

## Auth & guards

- `src/routes/admin.tsx` and `src/routes/super.tsx` gate via `useAuth().isAdmin`
  and `isSuperAdmin`, derived from `user_roles` (RLS-enforced).
- Roles live in `public.user_roles` with `app_role` enum (`customer`, `rider`,
  `admin`, `super_admin`). `is_admin()` and `has_role()` are SECURITY DEFINER
  helpers used by every privileged RPC + RLS policy.

## Realtime dashboards

`/admin` subscribes to `orders` and `deliveries` postgres_changes and
invalidates the `admin-kpis` query on any event. KPIs are fetched via
`admin_kpis()` RPC every 30s as a fallback. Charts use `admin_daily_series`,
`admin_meal_mix`, `admin_top_customers`, `admin_rider_performance`.

`/super` polls `super_overview()` every 60s — platform metrics rarely need
sub-minute precision.

## Operational RPCs (all SECURITY DEFINER, gated by `is_admin`)

| RPC | Purpose |
|---|---|
| `admin_kpis` | today's order/revenue/rider snapshot |
| `admin_daily_series(p_days)` | trend chart |
| `admin_meal_mix(p_days)` | breakfast/lunch/dinner split |
| `admin_top_customers(p_days, p_limit)` | leaderboard |
| `admin_rider_performance(p_days)` | per-rider delivered/failed/avg time |
| `admin_verify_payment` / `admin_reject_payment` | UPI queue |
| `admin_adjust_wallet` | manual credit/debit (audit-logged) |
| `assign_delivery` | manual rider assignment |
| `kitchen_create_batch` / `kitchen_dispatch_batch` / `kitchen_set_batch_status` | prep flow |
| `kitchen_meal_toggle` | open/close a meal for a date |
| `cancel_order_with_refund` | admin cancel + auto refund to wallet |
| `lock_orders_past_cutoff` | called by `/api/public/hooks/lock-orders` cron |
| `admin_resolve_ticket_with_refund` | support resolution with wallet credit |
| `admin_growth_kpis` / `admin_support_kpis` | growth & support widgets |
| `super_overview` | platform-wide totals |

## Super admin settings

`/super/settings` reads/writes `public.app_settings` (key/value JSONB):

- `cutoffs` — `{ breakfast_prev_night_hour, lunch_hour, dinner_hour }`
- `pricing` — `{ mini, large }`
- `rounds`  — `{ breakfast: [...], lunch: [...], dinner: [...] }`
- `payments` — `{ upi_vpa, merchant_name }`

RLS: read by any authenticated user, write only by `super_admin`. Changes
take effect immediately — `cutoff_for()` reads `cutoffs` on every order.

## Audit & security

- All sensitive mutations append to `audit_log` with `actor_id`, `action`,
  `target`, `meta`. Readable only by `super_admin`.
- RLS uses `is_admin(auth.uid())` / `has_role(auth.uid(), 'super_admin')`
  (SECURITY DEFINER) — never queries the policy's own table → no recursion.
- Wallet mutations only happen inside RPCs (no direct UPDATE policy on
  `wallets.balance` for clients) → ledger integrity guaranteed.

## UX

- Sidebar: `src/components/admin/AdminSidebar.tsx` — switches between admin
  and super variants.
- Layout: sticky live indicator header, full-width canvas, `bg-muted/40`.
- Charts: `recharts` with semantic tokens (`hsl(var(--primary))` etc.) to
  honor light/dark themes.
- Toasts: `sonner` for all mutation feedback.
- Empty states: every table has a friendly "no data yet" row.

## Extensibility checklist

- Add a new KPI → extend `admin_kpis()` JSONB, render in `admin.index`.
- Add a new admin page → create `src/routes/admin.<name>.tsx`, add link to
  `AdminSidebar` items array.
- Add a new role → extend `app_role` enum, write `has_role()`-based RLS.
- Add a setting → upsert under a new `app_settings` key, surface in
  `/super/settings`.
