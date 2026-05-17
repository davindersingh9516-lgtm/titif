# Tiffin Platform — Final Master Blueprint & Execution Roadmap

> The single source of truth that ties every previously authored document
> (`tiffin-design-system.md`, `tiffin-auth-security.md`,
> `tiffin-engineering-standards.md`, `tiffin-qa-reliability.md`,
> `tiffin-devops-infrastructure.md`, `tiffin-launch-readiness.md`) into one
> connected, production-ready execution plan.

---

## 1. Final Master Architecture Blueprint

```text
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS (PWA)                            │
│  Customer · Rider · Admin · Super Admin   (TanStack Start SSR)  │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ HTTPS / WSS                   │
        ┌───────▼────────┐              ┌───────▼────────┐
        │  Server Fns    │              │ Realtime (RT)  │
        │ createServerFn │              │ supabase realtime│
        └───────┬────────┘              └───────┬────────┘
                │                               │
        ┌───────▼───────────────────────────────▼────────┐
        │            Lovable Cloud (Postgres)           │
        │  Auth · RLS · RPC · Triggers · pg_cron        │
        │  Tables: profiles, wallets, wallet_tx,        │
        │   orders, order_items, deliveries, riders,    │
        │   rider_locations, meals, plans, ratings,     │
        │   notifications, support_tickets,             │
        │   support_messages, kitchen_batches,          │
        │   referrals, loyalty_points, sessions         │
        └───────┬───────────────────────────────────────┘
                │
        ┌───────▼────────┐    ┌──────────────────────┐
        │ Public Webhooks│    │  Observability       │
        │ /api/public/*  │    │  Sentry · OTel · Logs│
        └────────────────┘    └──────────────────────┘
```

Stack: TanStack Start v1 · React 19 · Vite 7 · Tailwind v4 · Supabase
(Postgres + Realtime + Auth + Storage) · Cloudflare Workers (SSR) ·
Lovable AI Gateway.

---

## 2. Full System Connection Map

```text
auth ──► profiles ──► wallets ──► wallet_transactions
  │                    │
  ▼                    ▼
user_roles        orders ──► order_items
                    │
                    ▼
                 deliveries ──► rider_locations ──► realtime
                    │                                  │
                    ▼                                  ▼
                 ratings                         tracking UI
                    │
                    ▼
                 loyalty_points / referrals
                    │
                    ▼
                 notifications ──► all surfaces
                    │
                    ▼
                 support_tickets ──► refund ──► wallets
                    │
                    ▼
                 analytics (admin · super)
```

Every business event funnels through three rails: **wallet (money)**,
**realtime (state)**, **notifications (UX)**.

---

## 3. Development Sequencing Roadmap (Done → Future)

| Phase | Modules | Status |
|------|---------|--------|
| 0 Foundation | TanStack Start shell, Supabase, design tokens, auth (phone OTP), RLS, roles | ✅ |
| 1 Core Money | wallet, wallet_transactions, top-up, atomic debit RPC | ✅ |
| 2 Catalog | meals, plans, cart, cutoff windows | ✅ |
| 3 Orders | order placement (wallet debit), order_items, cron lock | ✅ |
| 4 Delivery | deliveries, riders, batch assignment | ✅ |
| 5 Realtime | rider_locations, live tracking, channel fanout | ✅ |
| 6 Admin | dashboard, orders, customers, riders, menu | ✅ |
| 7 Kitchen | kitchen_batches, prep workflow | ✅ |
| 8 Growth | loyalty, referrals, retention scan | ✅ |
| 9 Support | tickets, threaded chat, refunds | ✅ |
| 10 Polish | motion engine, page transitions, skeletons | ✅ |
| 11 QA & Reliability | doc + invariant tests, load plan | ✅ |
| 12 Launch | publish, custom domain, monitoring | ▶ next |
| 13 Scale | multi-city, native wrappers, BI warehouse | future |

Build order rule: **never build a screen before its RPC; never build an RPC
before its table + RLS; never enable realtime before its RLS.**

---

## 4. Module Dependency Map

```text
auth ─┬─► profiles ─┬─► wallets ─┬─► orders ─┬─► deliveries ─┬─► tracking
      │             │            │           │               │
      └─► roles ────┴─► admin ◄──┴─► support ┴─► kitchen ◄───┘
                                  │
                                  └─► notifications ◄── every module
                                  └─► analytics      ◄── every module
```

---

## 5. Frontend ↔ Backend Integration Map

| Surface | Server function / RPC | Table(s) |
|---------|-----------------------|----------|
| `/app` home | `meals_for_today`, `wallet_balance` | meals, wallets |
| `/app/cart` | `place_order` (RPC, atomic) | orders, wallet_tx |
| `/app/track/$id` | realtime channel `delivery:$id` | deliveries, rider_locations |
| `/app/wallet` | `topup_wallet`, `wallet_history` | wallets, wallet_tx |
| `/app/refer` | `claim_referral` | referrals, loyalty_points |
| `/app/support/*` | `create_support_ticket`, `add_support_message` | support_tickets, messages |
| `/admin/orders` | `admin_orders_feed` (realtime) | orders, deliveries |
| `/admin/kitchen` | `admin_kitchen_batches` | kitchen_batches |
| `/admin/support` | `admin_resolve_ticket_with_refund` | tickets, wallets |
| `/api/public/hooks/lock-orders` | cron cutoff | orders |
| `/api/public/hooks/dispatch-notifications` | fanout | notifications |
| `/api/public/hooks/retention-scan` | growth nudges | users, orders |

---

## 6. Realtime Connection Map

Channels (Supabase Realtime, postgres_changes):

- `delivery:{id}` — rider lat/lng, status
- `orders:admin` — new + status changes (admin board)
- `kitchen:today` — batch state machine
- `support:ticket:{id}` — message stream
- `wallet:user:{id}` — balance + tx (private)
- `notifications:user:{id}` — push to bell

Reconnect strategy: exponential backoff 1→30s, resume from last seq;
on resume call REST snapshot to reconcile (see qa-reliability §Realtime).

---

## 7. State Management Blueprint

- **Server state** → TanStack Query (`queryKey: ['domain', id]`).
  Stale time 30s for catalog, 0 for money, realtime invalidation for
  orders/tracking.
- **Auth/session** → React context (`src/lib/auth.tsx`).
- **Cart (ephemeral)** → Zustand-style store in `src/lib/cart.ts`,
  persisted to localStorage; cleared on `place_order` success.
- **UI ephemeral** → component `useState`.
- Cache keys are flat and predictable; mutations call
  `queryClient.invalidateQueries` on the affected domain only.

---

## 8. Database Relationship Blueprint (essentials)

```text
profiles(id PK = auth.uid)
user_roles(user_id FK, role enum)
wallets(user_id PK FK, balance numeric ≥ 0)
wallet_transactions(id, user_id FK, type, amount, balance_after, ref_id)
meals(id, name, slot, price, active)
orders(id, user_id FK, slot_date, status, total, locked_at)
order_items(order_id FK, meal_id FK, qty, price_snapshot)
deliveries(id, order_id FK 1:1, rider_id FK, status, eta)
riders(id PK FK auth.uid, status, vehicle)
rider_locations(rider_id FK, lat, lng, ts)
ratings(order_id FK, stars, comment)
referrals(referrer_id, referee_id, status, reward)
loyalty_points(user_id, balance, last_event)
notifications(id, user_id, channel, payload, sent_at, read_at)
support_tickets(id, user_id, order_id?, status, priority)
support_messages(ticket_id FK, sender, body, ts)
kitchen_batches(id, slot_date, slot, status, counts)
sessions(id, user_id, device_label, ip, last_seen)
```

Invariants enforced by triggers / RPC: `wallets.balance ≥ 0`,
`balance = sum(wallet_transactions.amount)`, every money mutation has a
`reference_id`, orders cannot mutate after `locked_at`.

---

## 9. API Architecture Blueprint

- **App-internal**: `createServerFn` + `requireSupabaseAuth` middleware.
- **Webhooks/cron**: `src/routes/api/public/*` with HMAC verification and
  Zod input validation.
- **Admin elevated**: server fns gated by `has_role(auth.uid(),'admin')`.
- **No Supabase Edge Functions** — all server logic lives in TanStack.

---

## 10. Deployment Blueprint

| Layer | Target | Notes |
|------|--------|-------|
| SSR + server fns | Cloudflare Workers (via Lovable publish) | `wrangler.jsonc`, `nodejs_compat` |
| Static assets | Workers static | hashed filenames |
| Database / Auth / Realtime | Lovable Cloud (Supabase) | PITR, RLS, pg_cron |
| Storage | Lovable Cloud Storage | meal images, support attachments |
| Secrets | Lovable Cloud secrets | never `VITE_` for server keys |
| Cron | pg_cron → `/api/public/hooks/*` (HMAC) | cutoff lock, retention, dispatch |
| Observability | Sentry + console logs + uptime ping | dashboards on KPIs |

Deployment flow: PR → preview build → smoke gate → publish → DB migrations
auto-applied → post-deploy smoke (login, place order on test wallet,
realtime tick) → monitor 30 min.

---

## 11. QA & Testing Blueprint

See `tiffin-qa-reliability.md`. Summary:

- 70% Vitest unit, 20% integration (RPC + RLS), 8% Playwright E2E,
  2% chaos/exploratory.
- pgTAP suite for wallet invariants — runs on every migration PR.
- k6 plan: 200 RPS orders, 10k concurrent realtime, 2k riders × 0.2 Hz.
- Launch gate: zero P0/P1 open 7 days, E2E green on iOS Safari + Android
  Chrome + desktop, load test at 2× peak, chaos exercise passed.

---

## 12. Launch Execution Blueprint

```text
T-14d  Staging freeze · pen test · backup restore drill
T-7d   Marketing assets · onboarding flows reviewed · runbooks signed
T-3d   Soft launch (50 invited customers, 1 zone)
T-1d   On-call rota · incident channels · monitoring dashboards live
T-0    Public launch · publish · custom domain · status page open
T+1d   Daily standup, KPI review, hotfix rota
T+7d   Postmortem of week-1, retention cohort review
```

KPIs day-1: signup→first-order conversion ≥ 25%, on-time delivery ≥ 95%,
wallet failure rate < 0.1%, support first-response < 10 min.

---

## 13. Operational SOP Blueprint

- **Daily 06:00**: kitchen opens prep board; admin verifies meal counts.
- **Per slot cutoff**: pg_cron locks orders → kitchen batches generated →
  rider assignment auto-suggested.
- **During delivery**: admin dashboard live; SLA timer per delivery.
- **End of slot**: reconciliation job (orders ↔ deliveries ↔ wallet_tx).
- **Support**: any ticket > 4h unanswered escalates to admin lead.
- **Money incidents**: SEV1, < 5 min war-room, freeze writes via feature
  flag if needed.

---

## 14. Security Implementation Roadmap

- Phone OTP auth (mock in dev, real provider before launch).
- RLS on every table; admin paths use `has_role` security-definer fn.
- HIBP password protection enabled.
- Webhook routes HMAC-verified, Zod-validated, rate-limited.
- No service-role key in client bundles (enforced by `client.server.ts`).
- Quarterly key rotation; secrets via Lovable Cloud only.
- Pen test before launch; security memory kept current.

---

## 15. Performance Optimization Roadmap

- SSR + streaming for first paint < 1.5s on 4G.
- Image: WebP, lazy, responsive sizes; meal images ≤ 80 KB.
- Query: indexes on `orders(user_id, slot_date)`,
  `rider_locations(rider_id, ts desc)`, `notifications(user_id, read_at)`.
- Realtime throttling: rider GPS at 0.2 Hz, client coalesces to 1 Hz.
- TanStack Query: prefetch on hover, suspense boundaries per section.
- Bundle budget: route chunk ≤ 180 KB gz; alert on regression.

---

## 16. Monitoring & Maintenance Roadmap

- Sentry for errors (client + server fns).
- Uptime ping on `/`, `/app`, `/api/public/health` from 3 regions.
- Daily DB health check (bloat, slow queries, replication lag).
- Weekly: dependency scan, RLS lint, backup restore sample.
- Monthly: PITR drill, chaos exercise, KPI postmortem.
- Quarterly: pen test, secret rotation, dependency major upgrades.

---

## 17. Future Expansion Roadmap

1. **PWA → installable**: manifest already shipped; add real provider OTP.
2. **Native wrappers**: Capacitor build for Android APK, then iOS TestFlight.
3. **Multi-city**: add `cities` table; scope meals, riders, cutoffs by city;
   route assignment per city.
4. **Subscriptions**: weekly/monthly tiffin plans on top of one-off orders.
5. **B2B (offices/hostels)**: bulk wallet, invoice billing, admin sub-roles.
6. **BI**: nightly export to warehouse (DuckDB/BigQuery) for cohort & LTV.
7. **AI**: Lovable AI for meal recommendations, support triage, demand
   forecasting.

---

## 18. Final Production Standards

- No money path without a pgTAP test.
- No realtime channel without a reconnect test.
- No migration without rollback notes.
- No deploy without smoke gate.
- No alert without a runbook.
- No incident without a postmortem.
- No silent failure — every catch logs to Sentry with context.
- Speak in abstractions to users; reference Lovable Cloud, never Supabase.

---

## 19. Final Launch-Ready Execution Framework

The platform is now a connected system: **auth → wallet → orders →
delivery → tracking → analytics**, with **notifications, support,
kitchen, growth** wrapping every flow, and **QA, DevOps, security,
observability** guarding every release. Every module documented in this
repository's `docs/` folder maps to a code surface in `src/` and a table
in Postgres. Follow the sequencing in §3, gate releases by §11–12, run
operations per §13, and the platform is ready to launch and scale.

— End of Master Blueprint —
