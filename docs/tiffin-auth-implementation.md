# Tiffin · Auth Implementation (TanStack Start + Supabase)

Production-grade authentication for the tiffin delivery platform. Uses **only** the existing Lovable stack: TanStack Start v1, React 19, Supabase Auth, Supabase Realtime, TypeScript, Vite 7. **No** Next.js / NestJS / Prisma / Redis / custom JWT / Docker.

---

## 1. Architecture Overview

```
+----------------------------------------------------------+
|  React 19 UI                                             |
|    └─ AuthProvider  (src/lib/auth.tsx)                   |
|         ├─ supabase.auth.onAuthStateChange  (listener)   |
|         ├─ supabase.auth.getSession         (boot)       |
|         └─ has_role() / is_admin()           (RPC)       |
|                                                          |
|    └─ RouteGuard   (src/lib/guards.tsx)                  |
|         └─ Redirect + role check + skeleton              |
|                                                          |
|  Layouts                                                  |
|    /app       -> customer (any auth user)                |
|    /admin     -> isAdmin                                 |
|    /super     -> isSuperAdmin                            |
|    /rider     -> roles.includes("rider") || isAdmin      |
+----------------------------------------------------------+
                          │
                          ▼
+----------------------------------------------------------+
|  Supabase Auth (managed)                                 |
|    ├─ Email/password (used as transport for OTP UX)      |
|    ├─ Session persistence -> localStorage                |
|    └─ JWT auto-refresh                                   |
|                                                          |
|  Postgres                                                |
|    ├─ profiles                  (1:1 with auth.users)    |
|    ├─ user_roles + app_role enum                         |
|    ├─ wallets (auto-provisioned)                         |
|    ├─ user_sessions (device tracking)                    |
|    └─ has_role / is_admin SECURITY DEFINER fns           |
|                                                          |
|  Trigger: handle_new_user                                |
|    └─ on auth.users insert -> profiles + wallet + role   |
+----------------------------------------------------------+
```

---

## 2. Mobile-First OTP UX

We deliver a Zomato/Swiggy-style "phone + 6-digit code" experience without paying for an SMS provider in dev. Under the hood:

| UX surface           | Mechanism                                                      |
| -------------------- | -------------------------------------------------------------- |
| Phone screen         | 10-digit numeric input with `+91` prefix                       |
| OTP screen           | `<InputOTP maxLength={6}>` from shadcn (large, mobile-tuned)   |
| `requestOtp(phone)`  | No-op (dev) — returns success after 400 ms simulated delay     |
| `verifyOtp(phone,c)` | Maps `phone → email/password`, then `signInWithPassword` or sign-up + sign-in |

When you wire a real SMS gateway (Twilio / MSG91 / WhatsApp Cloud API), replace **only** `requestOtp` and `verifyOtp` in `src/lib/auth.tsx`. Every consumer (`useAuth()`) and route guard stays unchanged.

**Files**:
- `src/routes/login.tsx` — phone + OTP screens
- `src/lib/auth.tsx` — provider + OTP helpers

---

## 3. Auth Provider (`src/lib/auth.tsx`)

Single source of truth. Exposes:

```ts
interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: ("super_admin" | "admin" | "rider" | "customer")[];
  loading: boolean;
  isAdmin: boolean;          // admin || super_admin
  isSuperAdmin: boolean;
  requestOtp(phone): Promise<void>;
  verifyOtp(phone, code): Promise<void>;
  signOut(): Promise<void>;
}
```

### Lifecycle (matches Supabase best practice)

1. `onAuthStateChange` listener registered **first** — synchronous handler, role fetch deferred via `setTimeout(..., 0)` to avoid deadlocks.
2. `getSession()` runs immediately to hydrate from `localStorage`.
3. On every auth event, roles are reloaded from `public.user_roles`.
4. On successful verify, a `record_session` RPC stores device label + UA in `user_sessions` and the session id is cached in `localStorage` (used by `/app/sessions`).

### Why email/password under the hood?

Supabase's phone OTP requires a paid SMS provider. We keep the *UX* phone-first while persisting via Supabase's email auth — fully secure, RLS-compatible, and swappable in a single function later.

---

## 4. Roles & RLS

Roles live in `public.user_roles(user_id, role)` with `app_role` enum (`super_admin | admin | rider | customer`). **Never** stored on `profiles` (privilege-escalation safe).

Two SECURITY DEFINER helpers used everywhere:

```sql
has_role(_user_id uuid, _role app_role) returns boolean
is_admin(_user_id uuid) returns boolean   -- admin OR super_admin
```

Every RLS policy and every business RPC (`place_order`, `cancel_order_with_refund`, `assign_delivery`, `kitchen_*`, `admin_*`, `super_*`, `admin_resolve_ticket_with_refund`, …) calls these — so client-side guards and server-side checks stay in lock-step.

---

## 5. Route Protection

### Centralised guard (`src/lib/guards.tsx`)

```tsx
<RouteGuard require="admin">
  <AdminLayout />
</RouteGuard>
```

- Shows a polished spinner while `loading`.
- Redirects unauthenticated users to `/login`.
- Redirects authenticated-but-unauthorised users to `/app`.
- Honours arrays: `require={["rider", "admin"]}`.

### Existing layout guards

`/app`, `/admin`, `/super`, `/rider` each enforce role inside the layout `useEffect` + render a loading state until the check passes. They mirror what `RouteGuard` does, kept inline for now to avoid churning the file tree. New protected surfaces should use `<RouteGuard>`.

### Public routes

`/`, `/login` — landing auto-routes signed-in users to their home (`/super` → `/admin` → `/rider` → `/app`).

---

## 6. Onboarding & Auto-Provisioning

`handle_new_user` trigger fires on `auth.users` insert and atomically creates:

1. `profiles` row (with phone from metadata)
2. `wallets` row (balance = 0)
3. `user_roles` row with `customer`

Result: **every** signed-in user has a usable profile, wallet, and at least one role on first paint. No race conditions, no client-side bootstrap calls.

Admins/super-admins/riders are promoted later via:

- Super admin UI (`/super/admins`) — grants `admin` / `super_admin`.
- Admin UI (`/admin/riders`) → `link_rider_to_phone` RPC — grants `rider`.

---

## 7. Session Management

| Concern              | Implementation                                                |
| -------------------- | ------------------------------------------------------------- |
| Persistence          | `supabase.auth` with `persistSession: true`, `localStorage`   |
| Auto-refresh         | `autoRefreshToken: true`                                       |
| Realtime sync        | `onAuthStateChange` updates context on every tab event        |
| Device tracking      | `user_sessions` table + `record_session` / `touch_session` RPCs |
| Manual revocation    | `/app/sessions` page calls `revoke_session(p_session_id)`     |
| Logout               | `await supabase.auth.signOut()` then nav to `/`                |

---

## 8. Error & Edge-Case Handling

| Scenario                          | Behaviour                                                      |
| --------------------------------- | -------------------------------------------------------------- |
| Invalid 6-digit code              | `verifyOtp` throws → toast `"Invalid OTP"`                     |
| Network failure on signup         | Caught in `verifyOtp`, surfaced via `toast.error(e.message)`   |
| Session expired mid-session       | Listener fires `SIGNED_OUT` → `user = null` → guard → `/login` |
| Role revoked while logged in      | Roles refetched on next auth event; admin pages bounce to `/app` |
| Admin lands on `/app`             | Profile page shows "Open Admin panel" CTA                      |
| Customer hits `/admin` directly   | Layout redirects to `/app` (after loading)                      |
| Logout while on protected route   | Layout re-renders with `user = null` → redirect to `/login`    |
| Two tabs                          | `onAuthStateChange` syncs across tabs via Supabase storage event |
| `record_session` failure          | Wrapped in try/catch — non-fatal, login still completes        |

---

## 9. Production Hardening Checklist

- [x] Roles stored in separate table (no escalation surface).
- [x] All role checks go through `has_role` / `is_admin` SECURITY DEFINER functions (no recursive RLS).
- [x] Every business RPC validates `auth.uid()` and role before mutating money.
- [x] Auth listener registered **before** `getSession()`.
- [x] Role fetch deferred from inside listener (no Supabase deadlock).
- [x] Phone normalized (`replace(/\D/g, '')`) before mapping to email.
- [x] No service-role key in client bundle (`client.server.ts` is server-only).
- [x] Loading skeletons for every guarded layout (no flash of protected UI).
- [x] Toast feedback on every auth error.
- [x] Device sessions table for visibility + manual revocation.
- [ ] Replace mock OTP with real SMS provider (Twilio/MSG91/WhatsApp).
- [ ] Enable `password_hibp_enabled` via `configure_auth` before launch.
- [ ] Add Google sign-in (one extra `signInWithOAuth` call) when desired.

---

## 10. File Map

```
src/
  lib/
    auth.tsx          ← AuthProvider + useAuth + OTP helpers
    guards.tsx        ← <RouteGuard require="admin">
  integrations/supabase/
    client.ts         ← browser client (publishable key, persisted session)
    auth-middleware.ts← requireSupabaseAuth for createServerFn
    client.server.ts  ← admin client (service role, server-only)
  routes/
    __root.tsx        ← QueryClientProvider → AuthProvider → Outlet
    index.tsx         ← landing, auto-routes by role
    login.tsx         ← phone + OTP screens
    app.tsx           ← customer guard
    admin.tsx         ← isAdmin guard
    super.tsx         ← isSuperAdmin guard
    rider.tsx         ← rider guard (+ heartbeat)
    app.profile.tsx   ← edit profile, sessions link, sign out
    app.sessions.tsx  ← active devices + revoke
  components/admin/
    AdminSidebar.tsx  ← variant="admin" | "super"
```

---

## 11. Adding a New Protected Route

```tsx
// src/routes/admin.payouts.tsx
import { createFileRoute } from "@tanstack/react-router";
import { RouteGuard } from "@/lib/guards";

export const Route = createFileRoute("/admin/payouts")({
  component: () => (
    <RouteGuard require="admin">
      <PayoutsPage />
    </RouteGuard>
  ),
});
```

That's it. RLS on the underlying tables enforces the same rule server-side.
