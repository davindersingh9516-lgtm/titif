# Tiffin Platform — Engineering Execution System & Coding Standards

> Source of truth for **how** we write, review, ship, and scale code across the
> tiffin delivery platform. This document is consumed by humans **and** AI code
> generators. Every rule below is enforceable — if a PR violates it, it does not
> merge.

**Scope.** Frontend (Next.js App Router / TanStack Start mirror), Backend
(NestJS), Database (PostgreSQL + Prisma), Realtime (Socket.IO), Infra
(Docker / Nginx / PM2), and the AI generation contract.

**Non-goals.** No marketplace logic, no multi-vendor flows, no enterprise
bloat. We optimize for **operational clarity** in a single-kitchen, multi-rider,
city-scoped tiffin business.

---

## 0. Golden Rules (apply to every line of code)

1. **Boring code wins.** Prefer the obvious solution over the clever one.
2. **One responsibility per file.** If a file does two things, split it.
3. **Types are documentation.** No `any`, no implicit `unknown` returns from
   public functions.
4. **Server is source of truth.** The client never decides money, status, or
   cutoffs — it only displays what the server allows.
5. **Atomic writes.** Anything touching wallet, orders, or delivery status runs
   inside a single DB transaction or a single Postgres RPC.
6. **Fail loud in dev, fail safe in prod.** Throw early in development; return
   typed error envelopes in production.
7. **Realtime is a cache, not a contract.** UI must reconcile against an HTTP
   refetch when the socket drops.
8. **No secrets in client bundles.** `VITE_*` / `NEXT_PUBLIC_*` only for
   publishable values.
9. **Every change is observable.** Logs, metrics, or a Sentry breadcrumb — pick
   one before you ship.
10. **If it isn't tested at the boundary, it doesn't exist.** RPCs, API routes,
    and money paths require tests.

---

## 1. Repository & Folder Structure

### 1.1 Monorepo layout (target)

```
tiffin/
├── apps/
│   ├── web/         # Customer PWA (Next.js App Router)
│   ├── admin/       # Admin / kitchen / ops console
│   ├── rider/       # Rider PWA
│   └── api/         # NestJS backend
├── packages/
│   ├── ui/          # Shared shadcn-based component library
│   ├── types/       # Shared TS types & Zod schemas
│   ├── config/      # eslint, tsconfig, tailwind presets
│   └── sdk/         # Typed API client (generated from OpenAPI)
├── infra/
│   ├── docker/
│   ├── nginx/
│   └── pm2/
└── docs/
```

The current Lovable workspace uses the TanStack Start single-app layout. The
rules below are written so the same structure ports cleanly to the monorepo on
migration day (see `tiffin-devops-infrastructure.md`).

### 1.2 Frontend folder convention (per app)

```
src/
├── routes/                # File-based routes (TanStack) or app/ (Next)
├── components/
│   ├── ui/                # Pure shadcn primitives (no business logic)
│   ├── customer/          # Feature components, customer surface
│   ├── admin/
│   └── rider/
├── features/              # Feature folders: hooks + components + types
│   └── orders/
│       ├── hooks/
│       ├── components/
│       ├── api.ts         # TanStack Query hooks
│       └── types.ts
├── lib/                   # Pure utilities, framework-agnostic
├── hooks/                 # Cross-feature hooks
├── stores/                # Zustand stores (one slice per file)
├── integrations/          # Third-party SDK wrappers (supabase, sentry)
└── styles.css
```

**Rule:** Components in `components/ui/*` MUST NOT import from `features/*`,
`stores/*`, or `integrations/*`. UI primitives are dependency-free.

### 1.3 Backend folder convention (NestJS)

```
src/
├── modules/
│   └── orders/
│       ├── orders.module.ts
│       ├── orders.controller.ts
│       ├── orders.service.ts
│       ├── orders.repository.ts
│       ├── dto/
│       │   ├── place-order.dto.ts
│       │   └── order.response.ts
│       └── orders.spec.ts
├── common/
│   ├── filters/           # Global exception filters
│   ├── interceptors/      # Logging, response envelope
│   ├── guards/            # JwtAuthGuard, RolesGuard
│   ├── pipes/             # ZodValidationPipe
│   └── decorators/        # @CurrentUser, @Roles
├── infra/
│   ├── prisma/
│   ├── redis/
│   └── socket/
└── main.ts
```

---

## 2. Naming Conventions

| Artifact            | Convention             | Example                          |
|---------------------|------------------------|----------------------------------|
| Files (TS/TSX)      | `kebab-case.ts(x)`     | `place-order.dto.ts`             |
| React components    | `PascalCase`           | `OrderTimeline.tsx`              |
| Hooks               | `useCamelCase`         | `useLiveOrder`                   |
| Zustand stores      | `useXStore`            | `useCartStore`                   |
| TS types/interfaces | `PascalCase`           | `OrderStatus`, `RiderLocation`   |
| Enums               | `PascalCase` + `UPPER` | `MealType.LUNCH`                 |
| DB tables           | `snake_case`, plural   | `orders`, `wallet_ledger`        |
| DB columns          | `snake_case`           | `created_at`, `meal_type`        |
| RPCs                | `verb_noun`            | `place_order`, `lock_orders`     |
| Socket events       | `domain:verb`          | `order:status_changed`           |
| REST routes         | `kebab-case`, plural   | `/api/orders`, `/api/wallet-tx`  |
| Env vars            | `UPPER_SNAKE_CASE`     | `WHATSAPP_TOKEN`                 |

**Booleans:** prefix with `is`, `has`, `can`, `should` — `isLocked`, `hasRefund`.

---

## 3. Frontend Engineering Standards

### 3.1 Component rules

- **Server components by default** (Next App Router). Mark client with
  `"use client"` only when you need state, effects, or browser APIs.
- **Max 150 lines** per component file. Split when it grows.
- **Props are typed inline** for leaf components, exported as `XxxProps` for
  shared ones.
- **No prop drilling >2 levels.** Use a feature hook or context.
- **No business logic in JSX.** Compute in hooks or `useMemo`, render in
  return.

### 3.2 Page / route rules

- One route file = one screen. Layouts go in `__root.tsx` or `layout.tsx`.
- Every shareable route defines its own `head()` / `metadata` (title,
  description, og:title, og:description). No copy-pasted home metadata.
- Loaders are allowed only on authenticated layouts. Public routes fetch in
  components via TanStack Query.

### 3.3 State management

| Concern                 | Tool                  | Rule                                  |
|-------------------------|-----------------------|---------------------------------------|
| Server state            | TanStack Query        | Always — never `useEffect + fetch`.   |
| Form state              | React Hook Form + Zod | Always for >2 fields.                 |
| Ephemeral UI state      | `useState`            | Modals, toggles, hovers.              |
| Cross-page client state | Zustand               | Cart, theme, draft order, filters.    |
| URL state               | Search params         | Filters, tabs, pagination, dialogs.   |

**Zustand rules:**
- One store per domain (`useCartStore`, `useFiltersStore`).
- Persist only what's truly user-owned (cart draft, theme). Never persist
  server-derived data.
- Actions live inside the store; components call `store.action()`, never
  mutate state directly.

**TanStack Query rules:**
- Keys are arrays starting with the domain: `['orders', orderId]`,
  `['orders', 'list', filters]`.
- `staleTime` defaults: realtime data 0, dashboard data 30s, static lists 5min.
- **Optimistic updates** allowed only for: cart changes, notification reads,
  preference toggles. **Never** for money or order placement.
- Invalidate by **prefix**, not by exact key: `qc.invalidateQueries({ queryKey: ['orders'] })`.

### 3.4 Responsive & UX

- **Mobile-first.** Default styles target 360px. Breakpoints: `sm 640`,
  `md 768`, `lg 1024`, `xl 1280`.
- **Touch targets ≥ 44px.** Especially on rider/customer apps.
- **No horizontal scroll** at any breakpoint except intentional carousels.
- **Skeletons over spinners** for >300ms loads.
- **Empty states are designed**, not "No data".

### 3.5 Animation rules

- Framer Motion only for: page transitions, list reorders, modal/sheet enter,
  status pill transitions.
- Duration: 150–250ms. Easing: `[0.16, 1, 0.3, 1]` (out-expo) for entrances.
- Respect `prefers-reduced-motion`.
- **No animation on critical buttons** (Place Order, Mark Delivered).

### 3.6 Accessibility

- Every interactive element is a `<button>` or `<a>`, never a clickable `<div>`.
- Form inputs always have associated `<label>` or `aria-label`.
- Focus rings are visible (`focus-visible:ring-2`).
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text.
- Lighthouse Accessibility score ≥ 90 on every shipped route.

### 3.7 Design tokens

- Colors, radii, shadows live in `src/styles.css` as CSS variables in `oklch`.
- **Never** write `bg-white`, `text-black`, `#fff` in components. Always
  `bg-background`, `text-foreground`, `border-border`, etc.
- New surfaces require a new token, not a one-off hex.

---

## 4. Backend Engineering Standards (NestJS)

### 4.1 Module / Controller / Service / Repository

- **Controller** — HTTP only. Parses input via DTO, calls service, returns
  response. No DB, no business logic.
- **Service** — Business logic. Orchestrates repositories, queues, external
  APIs. Throws domain errors.
- **Repository** — Data access only (Prisma). Returns plain objects, never
  HTTP errors.
- **DTO** — One file per shape. Input DTOs use Zod; response DTOs are plain
  TS types exported to the SDK.

```ts
// orders.controller.ts
@Post()
@UseGuards(JwtAuthGuard)
async place(@CurrentUser() user: AuthUser, @Body(ZodPipe(PlaceOrderSchema)) dto: PlaceOrderDto) {
  const order = await this.ordersService.place(user.id, dto);
  return ok(OrderResponse.from(order));
}
```

### 4.2 API response envelope

Every successful response:

```json
{ "ok": true, "data": { ... }, "meta": { "requestId": "..." } }
```

Every error response:

```json
{ "ok": false, "error": { "code": "WALLET_INSUFFICIENT", "message": "...", "details": {} }, "meta": { "requestId": "..." } }
```

- HTTP status reflects category (400/401/403/404/409/422/429/500).
- `error.code` is a stable string consumed by the client SDK.
- Never leak stack traces, SQL, or internal identifiers in `message`.

### 4.3 Validation & sanitization

- All input validated with **Zod** at the boundary. No controller trusts the
  body.
- String fields always declare `min`, `max`, and a regex when shape is known.
- IDs are UUIDs (`z.string().uuid()`).
- Sanitize HTML only when rendering rich text — never strip on input.

### 4.4 Error handling

- Throw typed domain errors: `class WalletInsufficientError extends DomainError`.
- A single `DomainExceptionFilter` maps domain errors → HTTP envelope.
- Unknown errors → `500` with a generated `requestId`; full error logged to
  Sentry with the same `requestId`.

### 4.5 Logging

- Use `pino` with structured JSON. Required fields: `requestId`, `userId`,
  `route`, `latencyMs`, `status`.
- Log levels: `error` (paged), `warn` (dashboards), `info` (lifecycle),
  `debug` (dev only).
- **Never log secrets, OTPs, JWTs, or full wallet ledger rows.**

---

## 5. Database Engineering Rules (PostgreSQL + Prisma)

### 5.1 Schema conventions

- Tables `snake_case` plural; columns `snake_case`; PKs `id uuid default gen_random_uuid()`.
- Every table has `created_at timestamptz default now()` and `updated_at`
  maintained by a trigger.
- Soft-delete only when business demands it (`deleted_at timestamptz`). Default
  is hard delete with FK cascades.
- **Money** stored as `numeric(12,2)` — never `float` / `double`.
- Enums for finite domains (`order_status`, `meal_type`, `payment_method`).

### 5.2 Migrations

- One migration per logical change. Never edit a merged migration — write a new
  one.
- Migrations are reversible where possible (provide `DOWN` notes in PR).
- No `DROP COLUMN` on a table with live writers — do expand → backfill →
  contract over two deploys.

### 5.3 Indexing

- Index every FK column.
- Index every column used in `WHERE` of a hot query.
- Composite indexes match query column order.
- Use partial indexes for sparse hot paths
  (`WHERE status IN ('queued','out_for_delivery')`).
- Run `EXPLAIN ANALYZE` for any new query touching `orders`,
  `wallet_ledger`, or `rider_locations`.

### 5.4 Query rules

- Read paths use Prisma. Hot write paths (place_order, refund, OTP verify) use
  **Postgres RPCs** for atomicity.
- Never `SELECT *` in production code — list columns.
- Pagination is **cursor-based** for lists >1k rows; offset only for admin
  reports capped at 10k.
- All cross-row updates run inside `BEGIN; … COMMIT;` or an RPC.

### 5.5 RLS

- Every public-schema table has RLS enabled.
- Policies use `SECURITY DEFINER` helpers (`has_role`, `is_admin`) — never
  inline `auth.uid()` recursion.
- Roles live in a dedicated `user_roles` table — never on `profiles`.

---

## 6. Realtime Engineering Rules (Socket.IO)

### 6.1 Architecture

- Single Socket.IO server (`/realtime` namespace) fronted by Nginx with
  websocket upgrade.
- Multi-instance broadcast via `@socket.io/redis-adapter`.
- Rooms scoped by entity: `order:{id}`, `rider:{id}`, `admin:ops`.

### 6.2 Event naming

- Pattern: `domain:verb_noun` — `order:status_changed`, `rider:location_updated`,
  `wallet:balance_changed`.
- Payloads are **versioned**: `{ v: 1, ...payload }`. Bump `v` on breaking
  shape change; clients ignore unknown `v`.

### 6.3 Sync rules

- Realtime is a **delta channel**, not a state channel. Always seed UI from an
  HTTP fetch first, then apply socket deltas.
- Every realtime-driven UI must reconcile by refetching on `socket.io connect`,
  `visibilitychange → visible`, and after a 30s gap.

### 6.4 Reconnect

- Exponential backoff `1s → 30s` capped, jitter ±20%.
- Show a non-blocking "Reconnecting…" pill after 3s of disconnect.
- On reconnect, re-join rooms from a stored `joinedRooms` set.

---

## 7. API Engineering Rules

- **REST**, JSON only. No XML, no JSONP.
- Versioned by URL prefix: `/api/v1/...`. Breaking changes → `/v2`.
- HTTP verbs strict: `GET` read, `POST` create, `PATCH` partial update,
  `PUT` full replace (rare), `DELETE` remove.
- Resource routes plural: `/api/v1/orders/:id`.
- Nested routes max **2 levels**: `/orders/:id/items` is fine,
  `/orders/:id/items/:iid/notes` is not — flatten or create a separate resource.
- **Pagination:** `?limit=20&cursor=...`. Response includes
  `meta.nextCursor`.
- **Filtering:** explicit query params (`?status=queued&meal=lunch`). No DSLs.
- **Auth:** `Authorization: Bearer <jwt>`. Webhooks use HMAC `x-signature`.

---

## 8. Security Standards

- **Auth:** Email/password + Google OAuth. JWTs are short-lived (15min) +
  refresh (30d, httpOnly, sameSite=strict).
- Passwords hashed with `argon2id` (memory 19MiB, iterations 2). Never bcrypt
  for new code.
- **Rate limiting:** Nginx + app-level. Defaults: `100 req / IP / min` global,
  `10 / min` for `/auth/*`, `5 / min` for OTP verify.
- **CORS:** explicit allowlist of origins; never `*` on credentialed endpoints.
- **Headers:** HSTS, CSP (no `unsafe-inline` except styles), X-Frame-Options
  DENY, Referrer-Policy `strict-origin-when-cross-origin`,
  Permissions-Policy minimal.
- **Secrets** in env vars, surfaced via Lovable Cloud secrets in dev. Rotate
  every 90 days.
- **Webhook signatures** verified with `timingSafeEqual` — never `===`.
- **Input** trusted only after Zod parse. SQL via parameterized queries / Prisma
  only — no string concatenation.
- **PII** (phone, address, location) never logged at `info` level.

---

## 9. Performance Standards

### 9.1 Frontend

- LCP ≤ 2.5s on 4G mid-tier Android. CLS ≤ 0.1. INP ≤ 200ms.
- Route-level code splitting by default. Heavy components lazy-loaded with
  `React.lazy` + `Suspense`.
- Images via `next/image` (or equivalent), WebP/AVIF, explicit width/height.
- Avoid third-party scripts on critical paths. Defer analytics.

### 9.2 Backend

- p95 latency targets: read ≤ 150ms, write ≤ 300ms, `place_order` ≤ 400ms.
- Cache hot reads in Redis with explicit TTLs (menu 5min, settings 1min).
- N+1 audit on every PR touching list endpoints.
- Long-running work (notifications, reports) goes to BullMQ — never inline.

### 9.3 Caching keys

- `cache:menu:{date}` 5min
- `cache:settings:global` 1min
- `cache:rider:active` 10s
- Bust on write within the same transaction (publish event → worker invalidates).

---

## 10. Testing Standards

| Layer            | Tool                  | Coverage target |
|------------------|-----------------------|-----------------|
| Unit (FE/BE)     | Vitest                | 70% lines       |
| Component        | Vitest + RTL          | Critical only   |
| Integration (BE) | Vitest + supertest    | Every controller|
| E2E              | Playwright            | 5 happy paths   |
| Load             | k6                    | Pre-launch only |

**Mandatory tests:**
- `place_order` happy path + cutoff edge + insufficient wallet.
- Wallet ledger invariant: sum of credits − sum of debits = current balance.
- OTP verify: valid, expired, wrong code, rate-limited.
- Realtime: customer receives `order:status_changed` within 1s of admin update.

Tests run on every PR; merge blocked on failure.

---

## 11. CI/CD & Git Workflow

### 11.1 Branching

- `main` — always deployable.
- `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`, `chore/...`.
- No long-lived branches. Rebase on `main` daily.

### 11.2 Commits

Conventional Commits:

```
feat(orders): add cutoff override for admin
fix(wallet): prevent double-debit on retry
chore(ci): bump node to 20.12
```

### 11.3 Pull requests

- Title = top commit. Description includes **What / Why / How tested /
  Screenshots**.
- Max 400 lines of diff (excluding lockfiles, generated files). Larger PRs
  must be split.
- 1 reviewer required, 2 for migrations or money paths.
- Checks must pass: lint, typecheck, tests, build, security scan.

### 11.4 Pipeline

```
push → install → lint → typecheck → test → build → preview deploy
merge to main → build → migrate (manual approval) → deploy → smoke tests
```

---

## 12. Code Quality Tooling

- **ESLint** with `@typescript-eslint`, `eslint-plugin-react`,
  `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, import-order rules.
- **Prettier** — config in `packages/config`. No per-file overrides.
- **TypeScript** — `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`.
- **Husky + lint-staged** — runs prettier + eslint on staged files.
- **commitlint** — enforces Conventional Commits.

Forbidden patterns (lint errors):
- `any`, `as unknown as X`, `// @ts-ignore` without `// @ts-expect-error: <reason>`
- `console.log` in committed code (use `logger`)
- Hardcoded colors (`#`, `rgb(`, `bg-white`, `text-black`)
- `useEffect` with empty deps doing data fetching

---

## 13. Admin & Delivery Engineering Rules

### 13.1 Admin dashboards

- Tables use a single `<DataTable>` primitive: column defs, sorting, filtering,
  pagination, row actions.
- Filters serialize to URL search params (shareable links).
- Realtime tables debounce socket updates at 250ms to avoid render storms.
- Bulk actions require confirmation modal + reason field for destructive ops.

### 13.2 Rider tracking

- Rider app emits location every 10s when an active delivery is in progress,
  every 60s otherwise. Suspend on background.
- Customer map subscribes to `rider:{id}:location` only while order is
  `out_for_delivery`. Unsubscribe on `delivered` / `cancelled`.
- Stale location > 90s → show "Last seen <time>" and stop interpolating.

### 13.3 Delivery lifecycle (canonical states)

```
queued → preparing → ready → assigned → out_for_delivery → delivered
                                              ↘ failed → returned
                                              ↘ cancelled (refund path)
```

State transitions are only allowed via server RPCs. The client shows the
button; the server decides if it's legal.

---

## 14. AI Code Generation Rules

These rules govern any AI agent (Lovable, Cursor, Copilot, etc.) generating
code into this repo.

1. **Read before write.** Always inspect the file you're about to modify and
   the closest sibling pattern. Match the existing style.
2. **Smallest viable change.** Touch only what the request requires. Do not
   refactor adjacent code "while you're there".
3. **Frontend ≠ backend.** A UI request edits frontend only. Adding a column,
   RPC, or RLS policy requires an explicit data request.
4. **Schemas first.** Anything that crosses the wire (DTO, RPC, socket event)
   gets a Zod schema before the implementation.
5. **No new dependencies without justification.** Prefer the standard lib,
   then existing deps, then a new one. New deps require a one-line rationale
   in the PR.
6. **Tokens, not colors.** Never inline a hex value. Add a token to
   `styles.css` if needed.
7. **No placeholder content shipped.** "Lorem ipsum", "TODO", and stub
   buttons must not leak to a route the user can navigate to.
8. **Atomic money.** Wallet/order writes go through existing RPCs. Never
   compose multiple writes from the client.
9. **Realtime is additive.** New socket events must seed via HTTP and
   reconcile on reconnect.
10. **Verify before claiming done.** Run the relevant signal (build, test,
    network, console, browser) and report the actual result, not the intent.
11. **Memory-aware.** Respect `mem://` rules. Never re-introduce a rejected
    pattern.
12. **Security by default.** Public endpoints require signature/auth checks
    in the same PR that introduces them.
13. **Document the contract, not the implementation.** Comments explain
    *why*, not *what*.

---

## 15. Scalability & Maintainability Roadmap

| Stage          | Trigger                       | Action                                          |
|----------------|-------------------------------|-------------------------------------------------|
| **Single VPS** | < 500 orders/day              | Current Lovable Cloud + single Worker.          |
| **Vertical**   | 500–2k orders/day             | Bump VPS, enable PgBouncer, add Redis cache.    |
| **Split**      | 2k–10k orders/day             | Move API to dedicated Node host, keep Cloud DB. |
| **Sharded**    | 10k+ orders/day, multi-city   | Per-city DB schema, Socket.IO Redis adapter.    |

Maintainability checklist (run quarterly):
- Dependency audit (`bun audit`, `npm audit --production`).
- Dead code scan (`knip` / `ts-prune`).
- Unused indexes (`pg_stat_user_indexes`).
- Slow queries (`pg_stat_statements` top 20).
- RLS policy review.
- Secret rotation log.

---

## 16. Final Engineering Best Practices

- **Ship small, ship often.** A 50-line PR merged today beats a 500-line PR
  next week.
- **Own your code in production.** If you wrote it, you watch it for 24h
  after deploy.
- **Write the runbook with the feature.** New cron, new webhook, new
  background job → entry in `docs/runbooks/`.
- **Postmortem, not blame.** Every Sev-1 gets a written postmortem with
  action items, no individuals named.
- **Refactor when you read, not when you write.** Touch a file → leave it
  cleaner. Don't open a refactor branch in a vacuum.
- **The customer doesn't care about your stack.** They care that lunch
  arrives hot, on time, every day. Every standard above exists to serve that
  one outcome.

---

*End of engineering execution system. This document, together with*
`tiffin-devops-infrastructure.md` *and* `tiffin-launch-readiness.md`, *is the
complete operating manual for building and running the platform.*
