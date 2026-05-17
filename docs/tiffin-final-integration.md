# Tiffin Platform — Final Integration & Launch Playbook

End-to-end map of how every module in the platform connects, the realtime
contracts between them, and the launch execution checklist.

## 1. Module Map

```
                ┌──────────────────────────────────────────┐
                │              Supabase Postgres           │
                │  (RLS + SECURITY DEFINER RPCs + Realtime)│
                └──────────────────────────────────────────┘
                       ▲                ▲              ▲
            ┌──────────┘                │              └──────────┐
            │                           │                         │
   ┌────────┴────────┐         ┌────────┴────────┐       ┌────────┴────────┐
   │  Customer PWA   │         │   Admin Panel   │       │ Super Admin Panel│
   │ /app/*          │         │ /admin/*        │       │ /super/*         │
   └─────────────────┘         └─────────────────┘       └──────────────────┘
        │   ▲                       │   ▲                      │
        │   │ realtime              │   │ realtime             │ realtime
        ▼   │                       ▼   │                      ▼
   wallet, orders, deliveries, kitchen_batches, notifications, support_tickets
```

All cross-module mutations go through SECURITY DEFINER RPCs so the database is
the single source of truth and RLS stays simple.

## 2. End-to-End Business Flow

| # | Step | Trigger | RPC / Table | Realtime fan-out |
|---|------|---------|-------------|------------------|
| 1 | Customer logs in via OTP | `/auth` | `auth.signInWithOtp` → `handle_new_user` trigger creates `profiles + wallets + user_roles` | — |
| 2 | Add money | `/app/wallet` | `payments` insert → `submit_payment_utr` | admin queue subscribes to `payments` |
| 3 | Admin verifies UTR | `/admin/payments` | `admin_verify_payment` | wallet row updates → customer wallet realtime → `notify_user('wallet_credited')` |
| 4 | Customer places order | `/app/checkout` | `place_order` (atomic: cutoff check → wallet debit → order + items + event) | kitchen subscribes to `orders` |
| 5 | Kitchen batches | `/admin/kitchen` | `kitchen_create_batch` → `kitchen_set_batch_status` | rider sees assigned batch |
| 6 | Dispatch | `/admin/kitchen` | `kitchen_dispatch_batch` → `assign_delivery` per order | customer order status flips to `out_for_delivery` |
| 7 | Rider live tracking | `/rider/*` | `rider_heartbeat`, `rider_update_delivery` | customer `/app/track/$id` subscribes to `riders` + `deliveries` |
| 8 | OTP delivery | rider screen | `verify_delivery_otp` | order → `delivered`, analytics tick |
| 9 | Rate order | `/app/orders/$id` | `submit_order_rating` | growth KPIs |
| 10 | Support | `/app/support` | `create_support_ticket`, `add_support_message`, `admin_resolve_ticket_with_refund` | admin inbox + customer thread realtime |

## 3. Realtime Contracts

Single channel-per-domain pattern (already implemented in `use-*` hooks):

| Hook | Tables watched | Invalidates |
|------|----------------|-------------|
| `useWalletRealtime` | `wallets`, `wallet_transactions`, `payments` | `["wallet", uid]` |
| `useOrderRealtime(id)` | `orders`, `deliveries`, `order_events` | `["order", id]` |
| `useRiderLocation(riderId)` | `riders` row | local state |
| `useKitchenRealtime(date)` | `orders`, `kitchen_batches`, `deliveries` | `["kitchen", date, *]` |
| `useNotifications` | `notifications` (user-scoped) | `["notifications", uid]` |
| `useSupport(ticketId)` | `support_tickets`, `support_messages` | `["support", ticketId]` |
| `useAnalyticsRealtime` | `orders`, `wallet_transactions`, `deliveries` | `["analytics"]` |
| `useRealtimeResilience` (root) | reconnect on `online`/`visibilitychange`, invalidate all | — |

All channels are bound to React Query keys — no module reads from another's
local state directly.

## 4. Cross-Module Event Flow

```
place_order  ──▶ orders.insert ──▶ kitchen plan refresh
             ──▶ wallet_transactions.insert ──▶ wallet realtime
             ──▶ notify_user('order_confirmed') ──▶ notifications + WhatsApp queue

assign_delivery ──▶ deliveries.insert ──▶ order_events row
                ──▶ orders.rider_id update ──▶ customer track view

rider_update_delivery('delivered')
                ──▶ orders.status='delivered'
                ──▶ analytics RPCs recompute (admin_kpis, daily_series)

admin_verify_payment ──▶ wallets.balance update
                     ──▶ wallet_transactions row
                     ──▶ notify_user('wallet_credited')
```

## 5. Route Architecture (final)

```
/                     landing
/auth                 OTP login
/app                  customer shell (requires session)
  /app/menu           browse + add to cart
  /app/checkout       place order
  /app/orders         history
  /app/track/$id      live tracking
  /app/wallet         balance + recharge + UTR
  /app/support        tickets list + thread
  /app/profile        addresses, preferences
/admin                admin shell (requires admin role)
  /admin/dashboard    realtime KPIs
  /admin/orders       today's orders
  /admin/kitchen      prep + batch + dispatch
  /admin/riders       roster + live map
  /admin/payments     UTR verification queue
  /admin/support      ticket inbox
  /admin/analytics    charts + leaderboards
/super                super admin shell (requires super_admin role)
  /super/overview     GMV / float / admins
  /super/admins       grant/revoke roles
  /super/settings     pricing, cutoffs, growth knobs
/rider                rider shell (requires rider role)
  /rider/today        assigned deliveries
  /rider/delivery/$id update status + OTP capture
```

## 6. State Management

- Server state → React Query (single `QueryClient` per request).
- Realtime → Supabase channel hooks invalidate query keys; never write to
  query cache directly from a channel.
- Local UI state → component `useState` only. No Redux / Zustand.
- Auth session → `supabase.auth.onAuthStateChange` in a single provider.
- Cart → `localStorage` keyed by user id, hydrated on `/app/checkout`.

## 7. Production Readiness Validation

### Database
- [x] RLS on every public table
- [x] All cross-user writes through SECURITY DEFINER RPCs with `is_admin` / `has_role` checks
- [x] `place_order` enforces cutoff + balance atomically (single transaction)
- [x] `cancel_order_with_refund` mirrors wallet
- [x] `verify_delivery_otp` is the only path to `delivered`
- [x] Triggers: `handle_new_user`, `touch_updated_at`

### Auth
- [x] OTP via Supabase phone auth
- [x] No anonymous sign-in
- [x] Profiles + wallet + customer role auto-created on signup

### Realtime
- [x] Tables added to `supabase_realtime` publication: `orders`, `deliveries`,
  `riders`, `wallets`, `wallet_transactions`, `payments`, `kitchen_batches`,
  `notifications`, `support_tickets`, `support_messages`
- [x] Reconciliation on reconnect / tab focus (`useRealtimeResilience`)

### Frontend
- [x] App-level `AppErrorBoundary` + per-route `errorComponent`
- [x] `defaultPreloadStaleTime: 0`, retry policy skips 401/403/404
- [x] PWA manifest + service worker
- [x] Mobile-first layout, semantic tokens only

## 8. Launch Execution Checklist

### T-7 days
1. Run `supabase--linter`; resolve all errors.
2. Run `security--run_security_scan`; fix or document each finding.
3. Seed: menu items, super_admin role, at least one rider, one admin.
4. Configure pricing/cutoffs in `/super/settings`.
5. Configure WhatsApp provider secret if outbound enabled.

### T-3 days
6. End-to-end smoke test (see §9).
7. Lighthouse PWA audit ≥ 90.
8. Verify pg_cron jobs:
   - `lock_orders_past_cutoff()` every 5 min
   - `retention_scan()` daily
9. Load-check analytics RPCs against expected daily volume; convert to
   materialized view if `admin_daily_series` > 300ms.

### T-0 launch
10. Publish via Lovable.
11. Monitor `/admin/dashboard` for first hour.
12. Watch `notification_log` for stuck `retry` rows.

### T+1 day
13. Review `audit_log` for unexpected admin actions.
14. Review support ticket SLA.
15. Review rating averages (`admin_growth_kpis`).

## 9. End-to-End QA Script

| # | Persona | Action | Expected |
|---|---------|--------|----------|
| 1 | Customer | OTP login with new phone | Profile + wallet created (balance 0) |
| 2 | Customer | Submit ₹500 payment + UTR | Payment row pending |
| 3 | Admin | Verify payment | Wallet = ₹500 within 1s on customer screen |
| 4 | Customer | Place lunch order ₹150 before 10:00 IST | Wallet = ₹350, order placed |
| 5 | Customer | Try to cancel after cutoff | `cutoff_passed_no_self_cancel` |
| 6 | Admin | Cancel same order | Wallet refunded to ₹500, customer notified |
| 7 | Customer | Place order again | OK |
| 8 | Admin | Create batch + dispatch to rider | Order = `out_for_delivery` |
| 9 | Rider | Heartbeat + status updates | Customer track view shows live position |
| 10 | Rider | Submit wrong OTP | `invalid_otp` |
| 11 | Rider | Submit correct OTP | Order = `delivered`, analytics +1 |
| 12 | Customer | Rate 5★ food, 4★ rider | `admin_growth_kpis` updates |
| 13 | Customer | Open support ticket | Admin inbox realtime |
| 14 | Admin | Resolve with ₹50 refund | Wallet = +₹50, ticket resolved |
| 15 | Super admin | Toggle dinner closed for tomorrow | Customer cannot place dinner order |

## 10. Failure Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Realtime channel drop | `useRealtimeResilience` (online + visibilitychange) | Auto reconnect + invalidate queries |
| Stuck WhatsApp send | `notification_log.status='retry'` for > 1h | Worker retries with exponential backoff; manual `mark_notification_failed` |
| Wallet/Order desync | `wallet_transactions` vs `orders.total` mismatch | Replay via `cancel_order_with_refund` then re-place |
| Rider offline mid-route | `riders.last_seen_at` > 2 min | Admin reassigns via `assign_delivery` |
| pg_cron skipped | `orders.status='placed'` past cutoff | Manual call `select lock_orders_past_cutoff()` |

## 11. Post-launch Monitoring

- `/admin/dashboard` — operational pulse (orders, OFD, riders online).
- `/admin/analytics` — daily series, meal mix, top customers.
- `/super/overview` — GMV, wallet float, admin count.
- `notification_log` — channel health.
- `audit_log` — admin actions trail.

## 12. Scalability Path

1. Materialize `admin_daily_series`, `admin_meal_mix` (pg_cron refresh hourly).
2. Locality-based batching in `kitchen_create_batch` (group by `lat/lng` cluster).
3. Multi-city: add `city_id` to `orders`, `riders`, `kitchen_batches`; scope
   admin RLS by `city_id`.
4. Push notifications: add `web_push_subscriptions` table + edge function
   worker reading `notification_log.channel='push'`.

The platform is now fully wired: customer ↔ wallet ↔ order ↔ kitchen ↔
rider ↔ tracking ↔ analytics ↔ notifications ↔ support — all backed by
RLS-protected RPCs and Supabase Realtime.
