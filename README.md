# Tiffin Delivery Platform — Self-Hosted Edition

A production-ready, realtime tiffin (meal subscription) delivery platform with
customer PWA, admin and super admin panels, rider tracking, wallet system,
kitchen ops, analytics and support — all on TanStack Start v1 + Supabase.

## Stack

- **TanStack Start v1** (file-based routing, server functions, SSR)
- **React 19** + **TypeScript**
- **Vite 7**
- **Supabase** (Postgres + Auth + Realtime + Storage)
- **Tailwind CSS v4** + **shadcn/ui**
- **TanStack Query v5** for server state
- **PWA** (manifest + service worker)

No Lovable-only APIs. No proprietary platform dependencies. Runs anywhere
Node 20+ runs.

## 1. Prerequisites

- Node.js 20+ and Bun (`curl -fsSL https://bun.sh/install | bash`)
- A Supabase project (free tier works) — https://supabase.com
- (Optional) Supabase CLI for local migrations (`brew install supabase/tap/supabase`)

## 2. Supabase Setup

1. Create a new Supabase project. Note the project URL, anon (publishable)
   key, service-role key and project ref.
2. In the SQL editor, run `supabase/migrations/00000000000000_consolidated_schema.sql`
   end-to-end. This creates:
   - All enums (`app_role`, `meal_type`, `delivery_window`, `order_status`,
     `delivery_status`, `payment_status`, `ticket_*`, `menu_size`, …)
   - All tables (profiles, wallets, wallet_transactions, payments, orders,
     order_items, order_events, deliveries, riders, kitchen_batches,
     menu_items, daily_menu_overrides, support_tickets, support_messages,
     notifications, notification_log, notification_preferences, referrals,
     referral_codes, loyalty_accounts, loyalty_ledger, user_roles,
     user_sessions, audit_log, app_settings, invoices)
   - All RLS policies, triggers, indexes
   - All SECURITY DEFINER RPCs (place_order, cancel_order_with_refund,
     admin_verify_payment, kitchen_*, rider_*, notify_user, admin_kpis,
     admin_daily_series, super_overview, etc.)
3. Enable Realtime on these tables (Database → Replication):
   `orders, deliveries, riders, wallets, wallet_transactions, payments,
   kitchen_batches, notifications, support_tickets, support_messages`.
4. Authentication → Providers → enable **Phone** provider with your SMS
   provider of choice (Twilio, MessageBird, Vonage). Disable email signup
   if you only want phone OTP.
5. (Optional) Enable Leaked Password Protection under Auth → Providers → Email.

## 3. Local Development

```bash
cp .env.example .env
# fill in your Supabase URL + keys
bun install
bun run dev
```

Open `http://localhost:5173`.

## 4. Bootstrap Roles

After your first user signs up, promote them in the SQL editor:

```sql
insert into public.user_roles (user_id, role)
values ('<user-uuid>', 'super_admin');
```

Then sign in — `/super` and `/admin` are now accessible.

## 5. Seed Menu

```sql
insert into public.menu_items (meal_type, size, name, price, active) values
  ('breakfast','fixed','Poha + Tea',           50, true),
  ('lunch',    'mini', 'Mini Thali',          110, true),
  ('lunch',    'large','Large Thali',         150, true),
  ('dinner',   'mini', 'Mini Thali',          110, true),
  ('dinner',   'large','Large Thali',         150, true);
```

## 6. Production Build

```bash
bun run build
bun run preview        # smoke-test locally
```

Deploy the `.output/` (Cloudflare Workers) or `dist/` directory to any
Node/edge host (Cloudflare Workers, Vercel, Fly.io, your own VPS). Ensure
all env vars from `.env.example` are configured in your host.

## 7. pg_cron Schedules

In the Supabase SQL editor (extension `pg_cron` enabled):

```sql
select cron.schedule('lock-cutoffs', '*/5 * * * *',
  $$ select public.lock_orders_past_cutoff(); $$);

select cron.schedule('retention-scan', '0 9 * * *',
  $$ select public.retention_scan(); $$);
```

## 8. Project Structure

```
src/
  routes/                 file-based routes (TanStack)
    __root.tsx            html shell + providers + error boundary
    index.tsx             landing
    auth.tsx              OTP login
    app.*                 customer PWA
    admin.*               admin panel
    super.*               super admin panel
    rider.*               rider PWA
    api/public/*          webhooks / cron endpoints
  components/             ui + feature components (shadcn-based)
  hooks/                  use-auth, use-wallet, use-orders, use-kitchen,
                          use-rider-location, use-notifications,
                          use-support, use-analytics, use-realtime-resilience
  integrations/supabase/  client.ts (browser) + types.ts
  lib/                    utils + server functions (.functions.ts)
  styles.css              Tailwind v4 design tokens
supabase/
  migrations/             consolidated schema + RPCs + RLS
  config.toml             project ref
docs/
  tiffin-final-integration.md   end-to-end module map
  tiffin-production-hardening.md launch playbook
  tiffin-analytics.md
  tiffin-kitchen-ops.md
  tiffin-rider-tracking.md
  tiffin-notifications-support.md
  tiffin-admin-implementation.md
```

## 9. Module Map (TL;DR)

```
Customer PWA ──┐
Admin Panel  ──┼─▶ Supabase Postgres ◀── Supabase Realtime ─▶ all clients
Super Admin  ──┤      (RLS + SECURITY DEFINER RPCs)
Rider PWA    ──┘
```

Every cross-user mutation goes through a SECURITY DEFINER RPC
(`place_order`, `assign_delivery`, `admin_verify_payment`,
`verify_delivery_otp`, `kitchen_dispatch_batch`, …). RLS is the safety net.

## 10. End-to-End Smoke Test

See `docs/tiffin-final-integration.md` §9 for the 15-step QA script that
exercises every module from OTP login → wallet recharge → order →
batch → dispatch → live tracking → OTP delivery → rating → support
refund.

## 11. Removing Lovable Coupling

This export is already platform-agnostic:

- No `@lovable/*` packages
- `src/integrations/supabase/client.ts` reads from `import.meta.env.VITE_*`
- All backend logic lives in Supabase (Postgres functions) — no edge
  functions required
- PWA built with stock Vite + manifest

You can host the build output anywhere that serves a TanStack Start app.

## 12. License

MIT — adapt freely.
