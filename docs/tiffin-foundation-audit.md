# Tiffin Platform — Foundation Audit & Hardening (TanStack Start + Supabase)

> Stack lock: **TanStack Start v1 · React 19 · Vite 7 · Tailwind v4 · shadcn/ui · Supabase (Postgres + RLS + Realtime + Auth + Storage) · Cloudflare Workers SSR · Lovable AI Gateway**.
> No Next.js, NestJS, Prisma, Redis, Socket.IO, Docker, PM2, or Turborepo. All prior business logic (wallet, orders, kitchen, riders, tracking, admin, super-admin, support, growth, analytics, notifications) is preserved.

---

## 1. Current Layout (verified)

```
src/
├── routes/                    # File-based routes (TanStack)
│   ├── __root.tsx             # Shell: providers, HeadContent, Toaster
│   ├── index.tsx              # Public landing
│   ├── login.tsx              # Supabase Auth (email + Google)
│   ├── app.tsx + app.*.tsx    # Customer PWA surface
│   ├── admin.tsx + admin.*    # Admin panel
│   ├── super.tsx + super.*    # Super-admin panel
│   ├── rider.tsx + rider.*    # Rider app
│   └── api/public/hooks/*     # HMAC-verified cron/webhook routes
├── components/{ui,customer,admin,super,rider}/
├── hooks/                     # use-mobile, use-realtime-*, etc.
├── integrations/supabase/     # client.ts, client.server.ts, auth-middleware.ts, types.ts
├── lib/                       # auth.tsx, cart.ts, meals.ts, utils.ts, error-capture.ts
├── styles.css                 # Tailwind v4 tokens + motion engine
├── router.tsx                 # createRouter + QueryClient factory
├── start.ts / server.ts       # Worker SSR entry
└── routeTree.gen.ts           # AUTO-GENERATED — never edit
```

### Recommended additions (non-breaking)

```
src/
├── lib/
│   ├── constants.ts           # PLATFORM, ORDER_STATUS, ROLES, REALTIME_CHANNELS
│   ├── types.ts               # Shared domain types (re-export from supabase types)
│   ├── format.ts              # currency, date, distance, eta formatters
│   └── api/                   # *.functions.ts (createServerFn) + *.server.ts helpers
│       ├── wallet.functions.ts / wallet.server.ts
│       ├── orders.functions.ts / orders.server.ts
│       ├── kitchen.functions.ts / kitchen.server.ts
│       ├── support.functions.ts / support.server.ts
│       └── admin.functions.ts / admin.server.ts
└── features/                  # OPTIONAL — only if a route grows past ~400 LoC
    └── <domain>/{components,hooks,queries}.ts
```

Rule: keep `*.functions.ts` thin (only `createServerFn` + imports). Helpers, SQL builders, and `supabaseAdmin` calls live in `*.server.ts`. This prevents the transitive `client.server` leak documented in `tanstack-supabase-import-graph`.

---

## 2. Provider Architecture (`src/routes/__root.tsx`)

Order matters. Recommended tree:

```tsx
<QueryClientProvider client={queryClient}>
  <AuthProvider>          {/* src/lib/auth.tsx — wraps supabase.auth */}
    <TooltipProvider>
      <HeadContent />
      <PageTransition>
        <Outlet />
      </PageTransition>
      <Toaster />          {/* sonner */}
      <ScrollRestoration />
    </TooltipProvider>
  </AuthProvider>
</QueryClientProvider>
```

- `QueryClient` is created **per request** inside `getRouter()` (already correct in `src/router.tsx`) — never module-level.
- `defaultPreloadStaleTime: 0` so Query owns freshness.
- `AuthProvider` exposes `{ session, user, role, signIn, signOut, loading }` and uses `onAuthStateChange` BEFORE `getSession()`.

---

## 3. Route Tree & Protection

Three protected surfaces, one public:

| Surface | Layout file | Guard |
|--------|-------------|-------|
| Public | `index.tsx`, `login.tsx` | none |
| Customer | `app.tsx` | `beforeLoad`: require session |
| Admin | `admin.tsx` | `beforeLoad`: require session + `has_role('admin')` |
| Super-admin | `super.tsx` | `beforeLoad`: require session + `has_role('super_admin')` |
| Rider | `rider.tsx` | `beforeLoad`: require session + `has_role('rider')` |

Pattern (in each layout):

```tsx
beforeLoad: async ({ location }) => {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw redirect({ to: '/login', search: { redirect: location.href } });
  const { data: ok } = await supabase.rpc('has_role', { _user_id: data.user.id, _role: 'admin' });
  if (!ok) throw redirect({ to: '/app' });
},
```

Roles live in `public.user_roles` + `has_role(uuid, app_role)` SECURITY DEFINER (already migrated). **Never** store roles on `profiles`.

---

## 4. Error & Loading Boundaries

Every route with a loader MUST set:

```tsx
errorComponent: ({ error, reset }) => {
  const router = useRouter();
  return <ErrorState error={error} onRetry={() => { router.invalidate(); reset(); }} />;
},
pendingComponent: () => <CardSkeleton />,
notFoundComponent: () => <NotFoundState />,
```

Root route sets `notFoundComponent`. Router sets `defaultErrorComponent`. Wire `error-capture.ts` to log to console + (later) Sentry.

---

## 5. Supabase Client Architecture

| Client | Where | Auth | RLS |
|--------|-------|------|-----|
| `@/integrations/supabase/client` | components, browser hooks, realtime | publishable key + user session | enforced |
| `@/integrations/supabase/auth-middleware` (`requireSupabaseAuth`) | `createServerFn` handlers | bearer from request | enforced as user |
| `@/integrations/supabase/client.server` | `*.server.ts` only — admin jobs, webhooks | service role | bypassed |

Rules:
- Never import `client.server` from a component or `__root.tsx` chain.
- Never read `process.env.SUPABASE_SERVICE_ROLE_KEY` at module scope in shared files.
- Browser uses `import.meta.env.VITE_SUPABASE_*`. Server uses `process.env.SUPABASE_*`.

---

## 6. API Layer (`createServerFn`)

Canonical shape:

```ts
// src/lib/api/wallet.functions.ts
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { debitWalletTx } from './wallet.server';

export const debitWallet = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ amount: z.number().int().positive(), reference_id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => debitWalletTx(context.supabase, context.userId, data));
```

- Validate **every** input with Zod (min/max/regex).
- Return discriminated `{ ok: true, data } | { ok: false, error }` for recoverable failures; throw for fatal.
- Never put DB queries in route loaders directly — wrap in a server fn.
- Public HTTP (cron, webhooks) → `src/routes/api/public/*` with HMAC verification.

---

## 7. Realtime Architecture (Supabase Realtime)

Five canonical channels:

| Channel | Filter | Consumers |
|---------|--------|-----------|
| `delivery:{order_id}` | row updates on `deliveries` | customer track page, admin orders |
| `orders:admin` | new/updated `orders` | admin dashboard, kitchen |
| `kitchen:today` | `orders` filter `delivery_date=today` | kitchen board |
| `support:ticket:{id}` | `support_messages` | customer + agent threads |
| `wallet:user:{user_id}` | `wallet_transactions` | wallet page balance updates |

Standard hook (`src/hooks/use-realtime-channel.ts`):

```ts
useEffect(() => {
  const ch = supabase.channel(name)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [name]);
```

On reconnect: REST snapshot refetch via `queryClient.invalidateQueries`. Tables enabled in `supabase_realtime` publication: `orders`, `deliveries`, `wallet_transactions`, `support_messages`, `notifications`.

---

## 8. Shared Types & Constants

```ts
// src/lib/constants.ts
export const ROLES = ['customer', 'rider', 'admin', 'super_admin'] as const;
export const ORDER_STATUS = ['pending','confirmed','preparing','out_for_delivery','delivered','cancelled'] as const;
export const REALTIME = {
  delivery: (id: string) => `delivery:${id}`,
  walletUser: (uid: string) => `wallet:user:${uid}`,
  ticket: (id: string) => `support:ticket:${id}`,
  ordersAdmin: 'orders:admin',
  kitchenToday: 'kitchen:today',
} as const;

// src/lib/types.ts
import type { Database } from '@/integrations/supabase/types';
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Order = Tables<'orders'>;
export type WalletTx = Tables<'wallet_transactions'>;
```

`integrations/supabase/types.ts` is auto-generated — never hand-edit.

---

## 9. State Management

- **Server state** → TanStack Query (`useQuery`, `useSuspenseQuery`, `useMutation`).
- **Auth state** → `AuthProvider` context (single source).
- **Cart** → Zustand (`src/lib/cart.ts`) with `persist` middleware (already in place).
- **Local UI state** → `useState` / route search params.

Don't wrap server data in Zustand. Don't duplicate auth in Query.

---

## 10. Mobile-First Layout

- Primary viewport: 375–430 CSS px. All grids start single-column.
- `BottomNav` for `/app/*`, `/admin/*`, `/rider/*`. Hidden ≥ md when a sidebar exists (admin/super).
- Use `useIsMobile()` for behavior switches; use Tailwind `md:`/`lg:` for layout.
- Tap targets ≥ 44px. Use `.tap` / `.press` utilities from `styles.css`.

---

## 11. Notifications & Toasts

Single source: `sonner` via `toast.success/error/info`. `<Toaster />` once in `__root.tsx`. In-app notification center reads `public.notifications` (RLS: user_id = auth.uid()) with realtime subscription.

---

## 12. SEO & PWA Readiness

- Every shareable route defines `head()` with unique `title`, `description`, `og:title`, `og:description`. Leaf routes own `og:image`.
- Single H1 per page. Semantic `<main>`, `<nav>`, `<article>`.
- PWA: defer until publish. When added, follow the iframe-safe pattern in `pwa` knowledge (`devOptions.enabled: false`, registration guard against preview hosts, `NetworkFirst` for HTML). Manifest-only is enough for "Add to Home Screen".

---

## 13. Performance

- `defaultPreloadStaleTime: 0` + Query `staleTime` per query (e.g. menu 5min, wallet 10s, orders 0).
- Code-split admin/super/rider via TanStack's automatic route splitting (already on).
- Images: `loading="lazy"`, fixed `width`/`height`, prefer `.webp`.
- Avoid `select('*')` in hot paths — pick columns.
- Realtime: debounce 250ms on rider GPS writes; throttle map redraws to 1s.

---

## 14. RLS Baseline (verify with `supabase--linter`)

Every public table MUST have:
- `ENABLE ROW LEVEL SECURITY`
- Explicit `SELECT/INSERT/UPDATE/DELETE` policies
- For user-owned rows: `USING (user_id = auth.uid())`
- For role-gated rows: `USING (public.has_role(auth.uid(), 'admin'))`
- Money mutations only via SECURITY DEFINER RPCs (`debit_wallet`, `credit_wallet`, `admin_resolve_ticket_with_refund`) — never client direct UPDATE on `wallets`.

---

## 15. Code Quality Standards

- TypeScript strict. No `any` in shared types.
- Named exports for components; default export only for route files.
- Files ≤ 300 LoC; extract when larger.
- Tailwind via semantic tokens (`bg-primary`, `text-foreground`) — never raw hex in JSX.
- One responsibility per `*.functions.ts` file.
- Zod schemas colocated with their server fn.

---

## 16. Logging & Error Handling

- Client: `error-capture.ts` → `console.error` + window error listener (Sentry-ready hook).
- Server fns: try/catch around external calls; return typed error shape for recoverable, throw for fatal.
- Webhooks: log signature failures + payload hash (never full payload if PII).
- Realtime: log `subscribe` status changes once per channel.

---

## 17. Admin / Super-Admin Separation

- `admin.tsx` layout → operational staff (orders, kitchen, riders, support, growth, customers, menu).
- `super.tsx` layout → platform owners (admins management, settings, billing, multi-city).
- Distinct roles: `admin` vs `super_admin` in `app_role` enum.
- Sidebar components are separate (`AdminSidebar`, `SuperSidebar`) — no shared mutable state.

---

## 18. Production Readiness Checklist

- [ ] All tables have RLS + policies (`supabase--linter` clean)
- [ ] Every protected route has `beforeLoad` guard
- [ ] Every `loader` route has `errorComponent` + `pendingComponent`
- [ ] Root has `notFoundComponent`; router has `defaultErrorComponent`
- [ ] No `client.server` import reachable from `__root.tsx`
- [ ] No `process.env.*_SECRET_*` at module scope
- [ ] Wallet mutations only via SECURITY DEFINER RPCs
- [ ] Realtime channels cleaned up in `useEffect` return
- [ ] Each route has unique `head()` metadata
- [ ] Sonner `<Toaster />` mounted once
- [ ] Auth: email + Google enabled; HIBP password check on
- [ ] Cron hooks (`/api/public/hooks/*`) verify HMAC
- [ ] All inputs validated with Zod
- [ ] No `select('*')` in customer hot paths
- [ ] Build passes typecheck

## 19. Scalability Checklist

- [ ] Indexed: `orders(user_id, created_at)`, `deliveries(order_id)`, `wallet_transactions(wallet_id, created_at)`, `notifications(user_id, read_at)`
- [ ] Pagination on every admin list (cursor or offset+limit ≤ 50)
- [ ] Realtime publication only on tables that need it
- [ ] Rider location writes throttled server-side
- [ ] Support thread messages soft-paginated (last 50 + load more)
- [ ] Lovable Cloud instance size monitored; bump when p95 > 500ms

---

## 20. What NOT to do

- Don't add Next.js, NestJS, Prisma, Redis, Socket.IO, Docker, PM2, Turborepo.
- Don't hand-edit `routeTree.gen.ts`, `integrations/supabase/types.ts`, `integrations/supabase/client.ts`, or `.env`.
- Don't mutate `wallets.balance` directly from the client.
- Don't store roles on `profiles`.
- Don't import server-only modules into components.
- Don't bypass `beforeLoad` for auth in protected routes.

---

This audit is the canonical foundation reference for all subsequent prompts. Any future implementation MUST conform to these patterns.
