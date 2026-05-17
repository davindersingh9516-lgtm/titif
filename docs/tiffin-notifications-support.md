# Notifications, WhatsApp & Support — Implementation

Stack: TanStack Start v1 · React 19 · Supabase · Realtime · TypeScript · Vite 7

## Channels

| Channel  | Storage                   | Delivery                                                    |
| -------- | ------------------------- | ----------------------------------------------------------- |
| In-app   | `public.notifications`    | Supabase Realtime → `useNotifications` / `useUnreadCount`   |
| WhatsApp | `public.notification_log` | `/api/public/hooks/dispatch-notifications` (pg_cron, 1 min) |
| Toast    | derived from in-app       | Sonner toast on every realtime INSERT                       |

The single entry point on the server side is `notify_user(user_id, type,
title, body, link, payload, channels[], priority)`. It honors
`notification_preferences` (in_app + whatsapp toggles, low_balance_threshold)
and writes to either or both tables.

## Tables

- **notifications** — in-app inbox, RLS: self read/update/insert.
- **notification_log** — WhatsApp queue (status: queued/sending/sent/retry/failed),
  exponential backoff via `mark_notification_failed`.
- **notification_preferences** — `whatsapp`, `in_app`, `low_balance_threshold`.
- **support_tickets** — subject, category, priority, status, resolution_note,
  refund_amount.
- **support_messages** — thread of customer ↔ admin replies.

All have RLS: customers see their own, admins see all.

## RPCs

| RPC                                      | Caller   | Purpose                                                        |
| ---------------------------------------- | -------- | -------------------------------------------------------------- |
| `notify_user`                            | DB-only  | Universal notification dispatcher (called by other RPCs).      |
| `mark_notification_read` / `_all_read`   | customer | Mark inbox items read.                                         |
| `unread_notifications_count`             | customer | Live badge count.                                              |
| `claim_pending_notifications(limit)`     | cron     | Locks rows `for update skip locked`, advances to `sending`.    |
| `mark_notification_sent` / `_failed`     | cron     | Settle delivery state with retry/backoff.                      |
| `create_support_ticket`                  | customer | Open a ticket + first message + WhatsApp ack.                  |
| `add_support_message`                    | both     | Append to thread, auto-flips status, notifies the other party. |
| `admin_set_ticket_status`                | admin    | open / in_progress / waiting_customer / resolved / closed.     |
| `admin_resolve_ticket_with_refund`       | admin    | Resolve + atomic wallet credit + ledger + WhatsApp.            |
| `admin_support_kpis`                     | admin    | Dashboard widgets (open, urgent, refunds, avg resolution).     |

## Triggers that fan out automatically

- `place_order` → `order_confirmed` (+ `low_balance` if applicable)
- `cancel_order_with_refund` → `order_cancelled` + refund credit
- `assign_delivery` / `kitchen_dispatch_batch` → `out_for_delivery` events
- `verify_delivery_otp` → `delivered`
- `admin_verify_payment` → `wallet_credited`
- `admin_reject_payment` → `payment_rejected`
- `submit_payment_utr` → `payment_submitted`
- `retention_scan` (cron) → `win_back`, `recharge_nudge`

Every event is wallet-aware and idempotent.

## Realtime architecture

| Hook                  | Channel name                      | Tables watched                         |
| --------------------- | --------------------------------- | -------------------------------------- |
| `useNotifications`    | `notifications:user:{uid}`        | `notifications` (INSERT + UPDATE)      |
| `useUnreadCount`      | `notifications-unread:{uid}`      | `notifications` (\*)                   |
| `useMyTickets`        | `support:user:{uid}`              | `support_tickets`                      |
| `useTicket(id)`       | `ticket:{id}`                     | `support_messages` + `support_tickets` |
| `useOrders` / `useOrder` | `orders:user:{uid}` / `order:{id}` | `orders`, `order_events`, `deliveries` |
| `useWallet`           | `wallet:{uid}`                    | `wallets`, `wallet_transactions`, `payments` |

All hooks invalidate scoped TanStack Query keys on change → no manual state.

## WhatsApp dispatcher

`src/routes/api/public/hooks/dispatch-notifications.ts` is a public route
called by `pg_cron` every minute via the stable preview/published URL.

Flow per cycle:

1. `claim_pending_notifications(25)` — atomic claim with `for update skip locked`.
2. For each row, render `*title*\n\nbody\n\nOpen: link`.
3. POST to WhatsApp Cloud API `graph.facebook.com/v20.0/{phone_id}/messages`.
4. `mark_notification_sent` on 2xx, `mark_notification_failed` (with error
   snippet) otherwise — fail path applies exponential backoff
   (`2^attempts` minutes) up to `max_attempts = 5`.
5. If `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` are absent, items are marked
   `sent` with `provider: "noop"` so the queue never blocks during
   provisioning.

Required server secrets (set via `add_secret` when going live):

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`

## Support workflows

Customer:

1. `/app/support` → list of tickets (`useMyTickets`).
2. New ticket form → `createTicket()` → routes to `/app/support/{id}`.
3. Thread view → `useTicket(id)` → live messages + reply via `add_support_message`.

Admin (`/admin/support`):

- Tabbed queues: **Open**, **In progress**, **Waiting customer**, **Resolved**.
- KPI strip from `admin_support_kpis()` (open count, urgent, avg resolution
  hours, 7d refund total).
- Reply inline → `add_support_message`.
- Status change → `admin_set_ticket_status`.
- Resolve-with-refund modal → `admin_resolve_ticket_with_refund(id, note,
  amount)` → atomic wallet credit + ledger entry + WhatsApp.

Super admin: `/super` overview surfaces refund float + admin counts; deeper
support analytics live in `/admin/support` since both roles have access.

## Refund pathway

Two paths, both atomic and audit-logged:

1. **Order cancellation** — `cancel_order_with_refund(order_id, reason)`
   refunds the full order total + emits `order_cancelled`.
2. **Support resolution** — `admin_resolve_ticket_with_refund(ticket_id,
   note, amount)` credits any partial amount + emits `support_resolved`.

Manual override: `admin_adjust_wallet(user_id, delta, reason)` writes a
`wallet_transactions` row and an `audit_log` entry — used when neither path
above fits (e.g. goodwill credit).

## UX rules

- **Non-spammy**: every channel respects `notification_preferences`. Retention
  scans guard with "no win-back in last 7d / no recharge_nudge in last 3d".
- **Trustworthy**: WhatsApp messages link back to deep routes (`/app/wallet`,
  `/app/track/:id`, `/app/support/:id`).
- **Realtime first**: bell badge updates instantly on insert; no polling.
- **Offline-friendly**: Sonner toasts surface fresh notifications even when
  the inbox popover is closed.

## Extension points

- Add a new notification type → call `notify_user(...)` from any RPC, choose
  channels (`array['in_app','whatsapp']`), set priority (1 = highest).
- Add a new support category → extend `ticket_category` enum + UI picker; no
  RPC change required.
- Swap WhatsApp for Twilio → replace fetch block in
  `dispatch-notifications.ts`; queue contract is provider-agnostic.
- Add email channel → extend `channel` enum on `notification_log`, branch in
  the dispatcher.
