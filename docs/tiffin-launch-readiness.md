# Tiffin Platform — End-to-End Integration & Launch Readiness

> Final integration document. Pulls together every module already built (Auth, Wallet, Orders, Cutoffs, Rider, Realtime, Notifications, Analytics, Infra) into one operational picture, with checklists, SOPs, test plans, and a 14-day launch runway.

---

## 0. What is already wired today

| Module                | Where it lives                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Auth (phone OTP)      | `src/lib/auth.tsx`, `src/routes/login.tsx`                                                            |
| Sessions              | `user_sessions` table + `src/routes/app.sessions.tsx` + `record_session/touch_session/revoke_session` |
| Wallet                | `wallets`, `wallet_transactions`, `src/routes/app.wallet.tsx`, admin verification                     |
| Menu & cart           | `menu_items`, `src/routes/app.menu.tsx`, `src/routes/app.cart.tsx`                                    |
| Orders & cutoffs      | RPC `place_order`, `cutoff_for`, `lock_orders_past_cutoff` + cron hook                                |
| Live tracking         | `src/routes/app.track.$id.tsx`, Realtime on `orders` + `deliveries`                                   |
| Rider app             | `src/routes/rider*`, RPCs `rider_heartbeat`, `rider_update_delivery`, `verify_delivery_otp`           |
| Admin                 | `src/routes/admin*` — orders, riders, customers, menu, KPIs                                           |
| Super admin           | `src/routes/super*` — KPIs, settings, admins                                                          |
| Analytics             | `admin_kpis`, `admin_daily_series`, `admin_meal_mix`, `admin_top_customers`, `super_overview`         |
| Notifications         | `notifications`, `notification_log`, `notify_user`, dispatcher hook + cron                            |
| Cron automation       | `lock-orders-every-5min`, `dispatch-notifications-every-min`                                          |
| Infra (target)        | `docs/tiffin-devops-infrastructure.md`                                                                |

This document is what makes them all behave as **one system**.

---

## 1. End-to-end golden path

```
┌─ Customer ───────────┐    ┌─ Backend (Postgres + RPC) ──────┐    ┌─ Operations ──────┐
│  PWA loads           │    │                                 │    │                   │
│  Phone OTP login     │───▶│  auth.users + profiles + role   │    │                   │
│  Add money (UPI QR)  │───▶│  payments(pending) → admin verify──▶│  Admin verifies   │
│  Wallet credited     │◀───│  wallet_transactions + wallets  │    │                   │
│  Pick meal + add cart│    │                                 │    │                   │
│  Place order         │───▶│  RPC place_order (atomic):      │    │                   │
│   • cutoff check     │    │   debit wallet, create order,   │    │                   │
│   • address check    │    │   items, event, notify_user     │    │                   │
│  Order confirmed UI  │◀───│  Realtime INSERT on orders      │    │  Admin sees order │
│  Live track screen   │    │                                 │    │  Assigns rider    │
│                      │    │  RPC assign_delivery            │◀───│                   │
│  See rider on map    │◀───│  Realtime UPDATE on deliveries  │    │                   │
│  Receive WhatsApp +  │◀───│  notify_user → notification_log │    │                   │
│  in-app pings        │    │     → dispatcher hook → WA API  │    │                   │
│  Share OTP w/ rider  │    │                                 │    │                   │
│  Delivered           │◀───│  RPC verify_delivery_otp        │◀───│  Rider verifies   │
│  Receipt + KPI bump  │◀───│  orders.status='delivered'      │───▶│  KPIs update live │
└──────────────────────┘    └─────────────────────────────────┘    └───────────────────┘
```

Every arrow above is implemented. The remainder of this doc ensures each arrow stays green under load, failure, and edge cases.

---

## 2. Integration contracts (per module)

Every module exposes a contract. Breaking any of these is a P0.

### 2.1 Auth
- **Input**: Indian phone number (E.164).
- **Output**: Supabase session + role from `user_roles` (customer / rider / admin / super_admin).
- **Side effects**: `handle_new_user` trigger creates `profiles` row, empty `wallets` row, `customer` role.
- **Failure modes**: OTP invalid → toast, no role change. SMS provider down → fallback toast and retry.

### 2.2 Wallet
- **Reads**: `wallets.balance` per user (RLS: self only).
- **Writes**: only via `place_order` (debit) and `cancel_order_with_refund` (credit) and admin recharge verification.
- **Invariant**: `wallet_transactions.balance_after` always equals running sum. Verified nightly (see §6 invariants job).

### 2.3 Orders
- **Single entry**: RPC `place_order(meal, date, window, address, lat, lng, items, notes)`.
- **Atomicity**: cutoff check + wallet debit + order insert in one transaction with `FOR UPDATE` on the wallet row.
- **State machine**: `placed → preparing → out_for_delivery → delivered` or `cancelled`. Enforced by `lock_orders_past_cutoff` cron and `rider_update_delivery`.
- **Forbidden**: direct INSERT/UPDATE on `orders` from clients except admin overrides via RLS.

### 2.4 Delivery
- One active `deliveries` row per order. Created by admin RPC `assign_delivery`.
- Rider transitions: `assigned → picked_up → en_route → arrived → delivered | failed`.
- OTP gate: `verify_delivery_otp` is the only path to `delivered`.

### 2.5 Realtime
- Channels:
  - Customer: `orders` filter `user_id=eq.<uid>`, `deliveries` joined client-side, `notifications` filter `user_id=eq.<uid>`.
  - Rider: `deliveries` filter `rider_id=eq.<rid>`.
  - Admin dashboard: `orders` + `deliveries` (no filter).
- Reconnect: Supabase JS auto-reconnects with backoff. UI must show a "reconnecting…" state if `subscribe` enters `CHANNEL_ERROR` or `CLOSED`.

### 2.6 Notifications
- Single entry: `notify_user(user, type, title, body, link, payload, channels[], priority)`.
- Fan-out respects `notification_preferences`.
- Dispatcher: `/api/public/hooks/dispatch-notifications` — claim, send via WhatsApp Cloud API, mark sent or retry with exponential backoff. Soft no-op when WA secrets are missing.

### 2.7 Analytics
- All admin/super KPIs are SECURITY DEFINER RPCs gated by `is_admin()` / `has_role(super_admin)`.
- Refreshed live via Realtime invalidation on `orders`/`deliveries`; super dashboard polls every 60s.

---

## 3. Operational lifecycle (a day in production)

| Time (IST) | Trigger                                                  | What happens                                                               | Owner       |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------- |
| 00:05      | Cron `dispatch-notifications-every-min`                  | Drains overnight queue (recharge/refund pings)                             | Auto        |
| 06:00      | Kitchen opens                                            | Admin checks `/admin` for breakfast orders locked at 23:00 the night prior | Ops         |
| 07:30–09:30| Riders go online                                         | Heartbeat every 20s, admin assigns deliveries                              | Ops + Rider |
| 10:00      | Cron locks lunch orders past cutoff                      | `lock_orders_past_cutoff` flips `placed → preparing`                       | Auto        |
| 12:00–14:00| Lunch deliveries                                         | OTP verification, refunds for failures                                     | Rider + Ops |
| 15:00      | Dinner cutoff lock                                       | Same as lunch                                                              | Auto        |
| 19:00–21:30| Dinner deliveries                                        | Same as lunch                                                              | Rider + Ops |
| 22:00      | Daily reconciliation                                     | Wallet invariant check, KPI snapshot, backup                               | Auto        |
| 23:00      | Breakfast cutoff for next day                            | Customers can no longer place breakfast orders                             | Auto        |

SOPs for each role live in §7.

---

## 4. QA & test strategy

### 4.1 Test pyramid

```
          ╱ E2E (Playwright)            5%   — golden paths only
         ╱  Integration (Vitest + DB)  25%   — RPCs, RLS, realtime
        ╱   Unit (Vitest)              70%   — pure fns, hooks, utils
```

### 4.2 What we test (per module)

| Layer            | Tests                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Auth             | OTP rate limit, expired OTP, role redirect (customer/admin/rider/super)                            |
| RLS              | Customer cannot read other users' orders/wallet/notifications. Rider cannot see other riders' deliveries. Admin can. |
| `place_order`    | Cart empty, cutoff passed, address invalid, insufficient balance, wallet locked under concurrency  |
| `cancel_order`   | Customer after cutoff is rejected, admin override works, refund hits wallet exactly once           |
| `lock_orders`    | Idempotent — running twice does not double-flip or duplicate events                                |
| `rider_update`   | Forbidden when foreign rider, status mirrors to `orders` correctly                                 |
| `verify_delivery_otp` | Wrong OTP rejected, correct OTP transitions to delivered, idempotent on replay                 |
| Notifications    | Preferences gate respected, dispatcher retries with backoff, WA failure marks `failed` after `max_attempts` |
| Realtime         | Customer sees new order within 2s, rider sees assignment within 2s, dashboard KPIs refresh on insert |
| Analytics        | KPIs match raw SQL counts on a seeded dataset                                                      |

### 4.3 Load & soak

- **Tool**: k6.
- **Scenarios**:
  - 200 concurrent customers placing orders during lunch cutoff → p95 `place_order` < 400 ms, zero `serialization_failure`.
  - 50 concurrent riders heartbeating every 20s for 1 hour → no Realtime disconnects > 3.
  - Dispatcher under 1000 queued WhatsApp messages → drained within 5 minutes.
- **Pass criteria**: error rate < 0.1%, no row-lock timeouts, Postgres connections < 80% of `max_connections`.

### 4.4 Edge cases (must each have a test)

- Customer places order at cutoff − 1s, cron fires at cutoff + 0s. Order ends in `preparing`.
- Two devices place orders simultaneously with balance for only one. Exactly one succeeds, other gets `insufficient_balance`.
- Rider marks `delivered` then loses connectivity — replay does not double-credit / refund.
- Admin cancels an already-delivered order — RPC is a no-op (returns silently).
- WhatsApp API 5xx for 10 consecutive attempts — message ends up in `failed`, alert fires, in-app entry still visible.
- Customer disables WhatsApp pref mid-order — confirmation still appears in in-app center.
- Cutoff settings changed by super admin at 09:59 → 10:30. New time used by next cron run, no retroactive effect on placed orders.

### 4.5 UAT script (run before each release)

1. Sign up new phone, verify OTP, see home.
2. Recharge ₹500 via UPI QR → admin verifies → balance shows ₹500.
3. Place lunch order ₹90 → balance ₹410, order in `placed`, in-app + WhatsApp received.
4. Admin sees order in `/admin/orders`, assigns rider.
5. Rider logs in on second device → sees task → picks up → en route → arrived.
6. Customer reads OTP → rider verifies → status `delivered`.
7. KPIs update on admin and super dashboards.
8. Cancel a future order from customer side → refund visible in wallet.
9. Toggle WhatsApp pref off → place another order → only in-app fires.
10. Force WhatsApp API down (rotate token) → dispatcher retries → message ends up `failed` after 5 attempts.

---

## 5. Error recovery & resilience

| Failure                              | Detection                          | Recovery                                                                  |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| OTP send failed                      | Toast + log                        | User taps "Resend" (60s cooldown). Backup channel via SMS.                |
| Wallet debit but order not created   | Cannot happen — atomic RPC         | If ever observed: invariant job catches mismatch, super admin tool refunds|
| Rider GPS lost                       | `last_seen_at` > 90s               | UI flags "Rider offline"; ops can reassign via admin                      |
| Realtime channel `CHANNEL_ERROR`     | Subscription callback              | Auto-reconnect with backoff; UI shows "Reconnecting…" pill                |
| WhatsApp 429/5xx                     | Dispatcher response                | Mark `retry`, backoff `2^attempts` minutes, max 5 attempts                |
| Cron skipped a tick                  | Job log gap                        | Idempotent functions — next run catches up                                |
| Postgres failover                    | Health probe                       | App auto-reconnects via PgBouncer; API returns 503 briefly                |
| Cloudflare/Nginx down                | Uptime check                       | Page on-call, fail over via secondary IP / Cloudflare Always Online cache |

**Idempotency keys**: every RPC that mutates money or order state is safe to call twice — verified by tests.

---

## 6. Daily/Weekly automated checks

Add to cron (or pg_cron) and alert on failure:

| Check                                                                          | Frequency |
| ------------------------------------------------------------------------------ | --------- |
| Wallet invariant: `sum(amount) per user == balance`                            | Hourly    |
| Order accounting: `delivered + cancelled + active == total today`              | Hourly    |
| Notification dispatcher health: `count(status='queued' AND scheduled_for < now() - 10min)` should be 0 | Every 5 min |
| Backup completed and restorable (restore drill on staging)                     | Weekly    |
| RLS smoke test: anon role cannot SELECT from `orders/wallets/notifications`    | Daily     |
| Cron jobs ran in the last hour                                                 | Hourly    |

---

## 7. SOPs

### 7.1 Admin — daily operations
1. **Morning (06:00)**
   - Open `/admin` → check overnight pending orders, recharges, failures.
   - Verify any unverified UPI recharges.
2. **Per meal cycle** (B/L/D)
   - Confirm rider roster online (`/admin/riders`).
   - Assign deliveries as orders enter `preparing`.
   - Watch dashboard "Out for delivery" tile; investigate any > 60 min.
3. **Refunds & cancellations**
   - Use cancel-with-refund RPC — never edit wallet rows manually.
4. **End of day (22:30)**
   - Reconcile delivered count vs orders.
   - Note any rider failures and follow up.

### 7.2 Super admin — weekly
- Review `super.index` KPIs, GMV trends, refund ratio.
- Update cutoffs / pricing in `super.settings` only via the UI (writes go through `app_settings`).
- Add/remove admins in `super.admins` (uses `user_roles` SECURITY DEFINER policies).
- Review audit log for sensitive ops.

### 7.3 Rider — per shift
1. Open `/rider` → toggle online → grant location.
2. For each task: Confirm Pickup → Start Delivery (Maps opens) → Arrived → enter customer OTP.
3. On failure: select reason, mark failed. Customer is auto-refunded, ops notified.

### 7.4 Incident SOP
- **P0** (orders broken / payments broken): page on-call immediately. Open `#incidents`, post status. First action: health check + recent deploy rollback.
- **P1** (single user impacted, degraded perf): triage within 1 hour, fix within 24 h.
- Postmortem within 48 h for any P0/P1.

---

## 8. Security audit checklist

- [ ] All tables have RLS enabled (linter clean).
- [ ] No SECURITY DEFINER function exposes admin operations to unauthenticated users.
- [ ] `auth.users` is never referenced via FK from public schema.
- [ ] Roles stored only in `user_roles` (not on profile). `has_role()` used in policies.
- [ ] OTP table has no SELECT policy for `anon`/`authenticated`.
- [ ] Service role key never appears in client bundle (`grep -r "service_role" src/` clean).
- [ ] CSP, HSTS, X-Frame-Options set (handled at hosting layer).
- [ ] HIBP password check enabled (if/when password auth is added).
- [ ] Rate limit on OTP endpoint, recharge endpoint, place_order endpoint.
- [ ] Admin actions write to `audit_log`.
- [ ] Backups encrypted at rest, restore drilled.
- [ ] All `process.env.*` reads happen inside server functions / hooks, never module top-level in shared files.

---

## 9. Performance benchmarks (must pass before launch)

| Metric                                            | Target          |
| ------------------------------------------------- | --------------- |
| First contentful paint (4G, mid-tier Android)     | < 1.5 s         |
| Largest contentful paint (`/app`)                 | < 2.0 s         |
| Time to interactive (`/app/menu`)                 | < 2.5 s         |
| `place_order` p95                                 | < 400 ms        |
| Realtime event delivery (insert → UI) p95         | < 1.5 s         |
| Admin dashboard initial load with 1k orders/day   | < 1.2 s         |
| Lighthouse PWA score                              | ≥ 90            |
| Lighthouse Accessibility                          | ≥ 90            |

---

## 10. Launch readiness checklist (T-14 → T-0)

### T-14 days — feature freeze
- [ ] All P0/P1 bugs closed.
- [ ] UAT script passes end-to-end on staging.
- [ ] Database schema frozen (only hotfix migrations after this).
- [ ] Performance benchmarks met on staging (anonymized prod-size data).

### T-7 days — pre-prod hardening
- [ ] Backups + restore drill on staging successful.
- [ ] Load test passed (§4.3).
- [ ] All cron jobs verified running on prod backend (`select * from cron.job`).
- [ ] WhatsApp Cloud API templates approved by Meta.
- [ ] Rate limits live, tested.
- [ ] Sentry receiving prod errors, alert routes verified.
- [ ] On-call rota set; PagerDuty/Slack alerts firing as expected on synthetic incident.
- [ ] Runbooks committed: incident, rollback, secret rotation, db restore, domain swap.

### T-3 days — content & ops
- [ ] Menu items finalized (breakfast/lunch/dinner, mini/large, prices).
- [ ] Cutoff times verified against kitchen reality.
- [ ] Initial rider accounts onboarded; phones tested with PWA install.
- [ ] Super admin + admin accounts created.
- [ ] Customer support phone/WhatsApp number live and answered.
- [ ] T&Cs, Privacy, Refund policy pages published.

### T-1 day — go/no-go
- [ ] Final smoke test on production (place ₹1 test order with internal phone).
- [ ] Monitoring dashboards bookmarked.
- [ ] Communication ready: launch announcement (WhatsApp broadcast to early signups, Instagram post).
- [ ] Rollback rehearsed (revert image tag + DNS swap).

### T-0 — launch
- [ ] Open registrations.
- [ ] Live war-room (chat + voice) for first 4 hours.
- [ ] Monitor dashboards every 15 min.
- [ ] Capture every issue in a single sheet for next-day triage.

### T+1 → T+7 — stabilize
- [ ] Daily standup at 10:00 IST: yesterday's KPIs, open issues, today's focus.
- [ ] Hotfix deploys gated by CI green + manual approval.
- [ ] Postmortem any P0/P1.
- [ ] Customer feedback collected via in-app + WhatsApp; tagged and triaged.

---

## 11. Post-launch scaling roadmap

| Horizon | Trigger                              | Action                                                                 |
| ------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Month 1 | < 200 daily orders                   | Tune cutoffs, menu, pricing. Focus on retention, NPS.                  |
| Month 2 | 200–500 daily orders                 | Add second admin, second rider shift. Introduce subscriptions.         |
| Month 3 | 500–1000                             | Cache menu in Redis, add read replica, switch UPI to verified gateway. |
| Month 6 | First city expansion                 | Geo-fence per city, city-scoped admin role, regional cutoffs.          |
| Month 9 | Native APK                           | Capacitor wrap of existing PWA — same routes, push notifications.      |
| Year 2  | Multi-city ops at scale              | Move to Kubernetes only if 3+ engineers can on-call; otherwise stay.   |

---

## 12. Final production best practices

1. **Atomic RPCs > client-side multi-step flows.** Money and order state never live in the browser.
2. **RLS is the contract.** If a query feels too easy from the client, double-check the policy.
3. **Idempotency everywhere.** Cron, webhooks, retries — assume each will fire twice.
4. **Realtime is a UX layer, not a source of truth.** UI re-fetches on focus and on `subscribe` reconnect.
5. **Log structured, alert on rates not absolutes.** A single 5xx is noise; 1% is an incident.
6. **Backups you didn't restore don't exist.** Drill quarterly.
7. **Ship small, ship often, behind feature flags.** No big-bang deploys after launch.
8. **Customer trust > feature velocity.** Better to delay a feature than ship a broken refund.

---

## 13. Glossary of running pieces

| Name                                | What it is                                              |
| ----------------------------------- | ------------------------------------------------------- |
| `place_order`                       | Atomic RPC that debits wallet + creates order/items     |
| `cancel_order_with_refund`          | Atomic RPC that cancels + credits wallet + notifies     |
| `cutoff_for(meal, date)`            | Returns IST-aware cutoff timestamp                      |
| `lock_orders_past_cutoff`           | Cron-driven state advance from `placed → preparing`     |
| `assign_delivery`                   | Admin-only: link order to rider, create delivery row    |
| `rider_update_delivery`             | Rider state machine writes (with status mirror to order)|
| `verify_delivery_otp`               | Final OTP gate that marks order delivered               |
| `rider_heartbeat`                   | 20s GPS ping from rider PWA                             |
| `notify_user`                       | Central fan-out: in-app + WhatsApp respecting prefs     |
| `claim_pending_notifications`       | Dispatcher-only: pick batch with row-level lock         |
| `mark_notification_sent/failed`     | Dispatcher callbacks; failed schedules retry            |
| `admin_kpis` / `admin_*`            | Live dashboard RPCs, RLS-gated                          |
| `super_overview`                    | Platform-level KPIs, super-admin only                   |
| `lock-orders-every-5min` cron       | Calls `/api/public/hooks/lock-orders` every 5 min       |
| `dispatch-notifications-every-min`  | Calls `/api/public/hooks/dispatch-notifications` every min |

---

You are launch-ready when **every box in §10 is checked, every test in §4 is green, and every alert in §6 has fired at least once in a controlled drill.** Anything less is a soft launch — which is also a valid choice; just call it that.
