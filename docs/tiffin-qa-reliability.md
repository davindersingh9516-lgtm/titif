# Tiffin Platform — Production QA, Stability & Reliability System

> Single source of truth for testing, bug prevention, monitoring, and launch readiness.
> Scope: customer PWA, admin console, rider app, kitchen ops, wallet, realtime, delivery.

---

## 1. QA Architecture

**Pyramid (target mix):**
- 70% unit (pure functions, validators, reducers, RPC SQL logic)
- 20% integration (API + DB + Redis, RLS policies, server functions)
- 8% E2E (critical user journeys on real browser/PWA)
- 2% exploratory + chaos (manual + fault-injection)

**Environments:**
| Env | Purpose | Data | Auto-deploy |
|---|---|---|---|
| `local` | Dev sandbox | seeded fixtures | n/a |
| `preview` | PR validation | anonymized snapshot | every PR |
| `staging` | Pre-prod mirror | masked prod clone (weekly) | merge to `main` |
| `prod` | Live | real | manual promote + smoke gate |

**Tooling:**
- Vitest (unit/integration), Playwright (E2E + PWA), k6 (load), Artillery (Socket.IO load),
  pgTAP (DB invariants), Zod (runtime validation), Sentry (errors), OpenTelemetry (traces),
  Grafana + Loki (metrics + logs), UptimeRobot (synthetic).

---

## 2. Testing Strategy

**Definition of Done for any feature:**
1. Zod schema for every external input.
2. Unit tests on pure logic (≥ 90% lines on money/wallet/cutoff modules).
3. Integration test covering happy + 1 failure + 1 RLS-denial path.
4. E2E for any user-visible flow that touches money or delivery.
5. Telemetry: log + metric + trace span emitted for the new path.
6. Runbook entry if the feature has an on-call failure mode.

**Branch protection:** all of `lint`, `typecheck`, `unit`, `integration`, `e2e-smoke`,
`db-migration-dry-run`, `security-scan` must pass before merge.

---

## 3. Frontend Testing Workflows

**Component (Vitest + Testing Library):**
- Render with all variant props; assert a11y roles, not class names.
- Mock Supabase client via MSW; never hit network in unit tests.
- Snapshot only stable atoms (Button, Badge); never snapshot full pages.

**Page / route:**
- Use TanStack Router test harness; assert loader runs, error boundary catches,
  notFound boundary triggers on bad params.

**Mobile responsive:**
- Playwright projects: `iphone-13`, `pixel-7`, `ipad`, `desktop-1440`.
- Visual regression on: home, menu, wallet, track, support thread, admin kitchen.
- Tap targets ≥ 44×44 CSS px enforced via lint rule + Playwright `boundingBox` check.

**PWA:**
- Lighthouse CI budget: PWA ≥ 90, Perf ≥ 85, A11y ≥ 95, Best Practices ≥ 95.
- Test offline boot (service worker shell), background sync of queued orders,
  install prompt, push permission, "Add to Home Screen" icon.

**Realtime UI:**
- Mock `supabase.channel` to inject `INSERT/UPDATE/DELETE` events.
- Assert optimistic update → reconciled state on server confirm.
- Assert stale-channel cleanup on unmount (no memory leak).

**Wallet flow (frontend):**
- Recharge → QR shown → UTR submit → pending state → admin verify → balance updated.
- Insufficient balance blocks order CTA with clear copy + recharge link.

---

## 4. Backend Testing Workflows

**API / server functions:**
- Every `createServerFn` has a matching `*.test.ts` covering:
  auth required, input validation, happy path, RLS denial, idempotency.
- Use a per-test transaction that rolls back; never leak state.

**Auth:**
- Sign-up, login, session refresh, logout-all-devices.
- JWT tamper test (modified signature → 401).
- Role escalation attempt (customer hitting admin RPC → denied by RLS).

**Wallet (critical):**
- Property-based tests (fast-check): for any sequence of credit/debit/refund,
  `balance == sum(wallet_transactions.amount where user)` and
  `balance == last(balance_after)`.
- Concurrent debit race: 50 parallel order placements, only N≤balance succeed,
  no negative balance, no duplicate orders.

**Order:**
- Cutoff matrix per meal_type × timezone × DST boundary.
- Daily menu override (`is_open=false`) blocks placement.
- Cancellation refunds correct amount within window; outside window → denied.

**Delivery:**
- Batch creation groups only unbatched orders for the date+meal.
- Dispatch transitions all orders atomically; partial failure rolls back.
- OTP: 6 digits, single-use, 15-min TTL, rate-limited per phone.

**Realtime backend:**
- Publication includes `orders, deliveries, notifications, support_messages, kitchen_batches`.
- RLS replays on realtime payloads (user only sees own rows).

---

## 5. Realtime System Testing

**Socket.IO / Supabase Realtime:**
- Reconnect storm: kill WS, assert exponential backoff (1s, 2s, 4s, max 30s),
  channel resubscribes, no duplicate event handlers.
- Network flap (offline 10s → online): missed events backfilled via `select` on resume.
- Rider tracking: 1 update/5s; assert UI throttles to 1/2s render, marker interpolates.
- Multi-tab: same user open in 2 tabs, both receive same event exactly once per tab.

**Sync invariants:**
- Order status displayed = max(client_optimistic, server_authoritative).
- Conflict resolver: server wins on `updated_at` tiebreak.

---

## 6. Wallet Testing Strategy

**Invariants (pgTAP):**
1. `wallets.balance >= 0` always.
2. `wallets.balance = (select coalesce(sum(amount),0) from wallet_transactions where user_id=w.user_id)`.
3. Every `wallet_transactions` row has monotonically correct `balance_after`.
4. No `wallet_transactions` without a `reference_id` for `order_debit`, `refund`, `recharge`.

**Flows:**
- Recharge: QR → UTR → admin verify → credit + ledger + notification.
- Debit: order placement deducts atomically inside SQL function with `FOR UPDATE`.
- Refund: support resolution credits + ledger entry typed `refund` referencing ticket.
- Reconciliation cron (daily 02:00): diff balances vs ledger sum → alert on mismatch.

---

## 7. Delivery Testing Strategy

- Rider assignment: round-robin among `online=true AND active=true`; fallback to manual.
- OTP verify: customer reads code → rider enters → status `delivered`, `delivered_at` set.
- Failed delivery: reason captured, order status `failed`, auto-refund triggered, support ticket auto-created.
- Late delivery (> SLA): notify customer + ops, mark `delayed`, no auto-refund (admin decision).
- Geofence: rider must be within 150m of address to mark delivered (anti-fraud).

---

## 8. Load Testing Strategy

**Targets (per pod, can scale horizontally):**
| Surface | Target | Tool |
|---|---|---|
| Order placement | 200 RPS, p95 < 400ms | k6 |
| Realtime channels | 10k concurrent | Artillery + custom WS |
| Wallet debit (hot user) | 50 concurrent / user, 0 errors | k6 |
| Admin dashboard query | 50 RPS, p95 < 600ms | k6 |
| Rider location updates | 2k riders × 1/5s | Artillery |

**Load test schedule:** weekly on staging; before any launch milestone; after schema migrations touching hot tables.

---

## 9. Error Recovery Strategy

**Layers:**
1. **Input** — Zod rejects with 400 + field errors before any side effect.
2. **Transaction** — every multi-write op in a single SQL function with `BEGIN/EXCEPTION`.
3. **Idempotency** — client sends `Idempotency-Key`; server stores → safe retry.
4. **Compensation** — failed delivery → auto-refund; failed payment verify → reversal entry.
5. **DLQ** — `notification_log` retries up to `max_attempts`, then `status=dead`, alert ops.

---

## 10. Retry Handling Architecture

| Surface | Strategy | Cap |
|---|---|---|
| Network fetch (client) | exp backoff + jitter | 3 retries |
| Realtime subscribe | exp backoff | infinite, max 30s |
| Notification send | exp backoff in `notification_log` | 5 attempts |
| Webhook receive | idempotency key dedupe | n/a |
| Background cron | next tick on failure + alert | n/a |

Never retry: 4xx (except 408/429), validation errors, RLS denials.

---

## 11. Monitoring Strategy

**Metrics (Prometheus/Grafana):**
- `orders_placed_total`, `orders_failed_total{reason}`, `wallet_debits_total`, `wallet_balance_drift`.
- `realtime_connections_active`, `realtime_reconnects_total`.
- `delivery_p95_seconds`, `notification_dlq_size`.
- HTTP: rate, errors, duration (RED) per route.

**Logs (Loki):**
- Structured JSON: `ts, level, request_id, user_id, route, latency_ms, error`.
- PII scrubbed at logger boundary (phone, address hashed).

**Alerts (PagerDuty):**
| Severity | Condition |
|---|---|
| P1 | Order placement error rate > 2% over 5min |
| P1 | Wallet drift detected by reconciliation cron |
| P1 | Realtime connection drop > 10% in 1min |
| P2 | Notification DLQ > 50 |
| P2 | API p95 > 1s for 10min |
| P3 | Rider offline > 30min during peak |

---

## 12. Bug Prevention Standards

- **Zod everywhere** at boundaries (HTTP, server fn, webhook, env).
- **No `any`**; `unknown` + narrow.
- **Money** as integer paise / `numeric` in DB; never `number` JS for currency math beyond display.
- **Time** in UTC in DB, IST in UI; one converter module.
- **Enums** as Postgres enums + TS literal unions generated from DB.
- **Discriminated unions** for status state machines (compile-time exhaustiveness).
- **Lint rules**: no floating promises, no console in prod, no direct `supabase.from().insert()` in components (must go through service layer).

---

## 13. Transaction Safety Standards

- All multi-row writes in one SQL function with explicit `LOCK` or `FOR UPDATE`.
- Wallet ops use `SERIALIZABLE` isolation OR row-level lock + ledger append.
- Outbox pattern for side effects: write event row in same tx, worker emits later.
- Never trust client-supplied amount; recompute server-side from menu + qty.

---

## 14. Validation Standards

- Schemas in `src/lib/schemas/*.ts`, shared client + server.
- Phone: E.164, India default; Address: free text + lat/lng required for delivery.
- File uploads: mime sniff + size cap server-side; never trust client mime.
- Reject unknown keys (`.strict()`); strip rather than coerce.

---

## 15. Production Stability Workflows

- **Migrations**: forward-only, additive first (add column nullable → backfill → enforce).
- **Feature flags** for risky launches; default off; per-user / per-cohort rollout.
- **Canary**: 5% → 25% → 100% over 24h on big changes.
- **Auto-rollback** if error rate doubles within 10min of deploy.

---

## 16. Deployment Validation Checklist

Pre-deploy:
- [ ] All CI gates green
- [ ] Migration dry-run on staging clone
- [ ] Secrets present in prod env
- [ ] Feature flag default verified
- [ ] Runbook updated

Post-deploy smoke (automated, < 2min):
- [ ] Health endpoint 200
- [ ] Login + place test order on synthetic account
- [ ] Wallet recharge mock flow
- [ ] Realtime channel receives test event
- [ ] Admin dashboard loads with KPIs

---

## 17. Security Testing Strategy

- OWASP ASVS L2 baseline.
- Auth: brute force (rate-limit 5/min/IP+phone), session fixation, JWT alg=none rejected.
- RLS fuzzer: for each table, attempt cross-user read/write — must deny.
- OTP: rate-limit per phone (3/hour), per IP (10/hour), code never logged.
- CSP, HSTS, X-Frame-Options=DENY, Referrer-Policy=strict-origin-when-cross-origin.
- Dependency scan weekly + on PR; block on high/critical.
- Pen test before launch + annually.

---

## 18. Mobile Testing Strategy

- Real-device matrix: iPhone 12/15, Pixel 6/8, Galaxy A-series (low-end).
- Throttled network: Slow 3G → app must remain usable for menu + wallet view.
- Battery: location tracking on rider app < 8% / hour drain.
- Touch ergonomics: bottom-nav reachable thumb-zone; primary CTA never above fold-fold.

---

## 19. PWA Testing Strategy

- Install flow on iOS Safari + Android Chrome.
- Offline: cached shell + last menu visible; order CTA disabled with clear copy.
- Background sync: queued action retries on reconnect.
- Push: opt-in modal, delivery & wallet alerts, deep-link into route.
- Update flow: new SW → toast "Update available" → reload.

---

## 20. Performance Benchmarking

| Metric | Budget |
|---|---|
| LCP (4G mid-tier) | < 2.5s |
| INP | < 200ms |
| CLS | < 0.1 |
| TTI customer home | < 3s |
| JS bundle (initial route) | < 180 KB gz |
| API p95 (read) | < 250ms |
| API p95 (write) | < 500ms |
| Realtime event delivery | < 800ms p95 |

Enforced via Lighthouse CI + size-limit + k6 thresholds.

---

## 21. Operational Reliability Strategy

- SLO: 99.9% monthly availability; error budget 43min/month.
- Runbooks for: payment stuck, rider offline storm, kitchen dispatch jam,
  realtime outage, DB primary failover, notification provider down.
- Weekly ops review: error budget burn, top 5 incidents, top 5 latency offenders.
- Quarterly game day: chaos exercise (kill DB replica, drop Redis, throttle network).

---

## 22. Incident Recovery Strategy

**Severity ladder:**
- **SEV1** — money loss, data loss, full outage. War room < 5min, comms every 15min.
- **SEV2** — degraded core flow. Ack < 15min, fix < 4h.
- **SEV3** — minor / cosmetic. Next business day.

**Timeline template:** Detect → Acknowledge → Mitigate → Resolve → Postmortem (blameless, within 5 business days).

**Recovery primitives:**
- DB PITR (point-in-time recovery) tested monthly.
- Wallet replay from `wallet_transactions` rebuilds `wallets.balance` deterministically.
- Order state replay from `order_events` rebuilds current `orders.status`.

---

## 23. Launch Readiness Validation

Go / no-go checklist (must be 100% green):

**Product**
- [ ] All P0/P1 bugs closed for 7 days
- [ ] Customer flow E2E green on 3 devices
- [ ] Admin + rider + kitchen flows E2E green

**Reliability**
- [ ] Load test at 2× expected peak passes thresholds
- [ ] Chaos exercise passed in last 30 days
- [ ] Backups verified by restore drill

**Security**
- [ ] Pen test report reviewed, criticals closed
- [ ] Secrets rotated, RLS audit clean
- [ ] Rate limits enabled on auth + OTP + write APIs

**Ops**
- [ ] On-call rota staffed, PagerDuty tested
- [ ] Runbooks linked from every alert
- [ ] Status page + customer comms templates ready

**Legal/Compliance**
- [ ] Terms + Privacy + Refund policy live
- [ ] Data retention + deletion flow implemented

---

## 24. Final Production QA Standards

1. **No silent failures.** Every catch logs with context + emits a metric.
2. **No money path without a test.** Period.
3. **No realtime feature without reconnect test.**
4. **No migration without rollback plan.**
5. **No deploy without smoke gate.**
6. **No alert without a runbook.**
7. **No incident without a postmortem.**
8. **No assumption — measure, then ship.**

---

*Owner: Engineering + Ops. Review cadence: monthly. Last revised: 2026-05-11.*
