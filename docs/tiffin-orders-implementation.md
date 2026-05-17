# Order Management — Implementation Reference

Stack: TanStack Start v1 · React 19 · Supabase (Postgres + RLS + Realtime) · TypeScript · Vite 7. No Next.js / NestJS / Prisma / Redis / Docker / custom microservices.

## Business model

- **Wallet-only ordering** — every order debits `wallets.balance` atomically inside `place_order()`. Insufficient balance ⇒ `insufficient_balance` exception, UI routes to `/app/wallet`.
- **Fixed catalogue**
  - Mini Thali — ₹60 (`menu_size = 'mini'`)
  - Large Thali — ₹90 (`menu_size = 'large'`)
  - Breakfast — ₹fixed daily (`menu_size = 'fixed'`)
- **Delivery rounds** (`delivery_window` enum: `round_1 | round_2`)
  - Breakfast: R1 7–8 AM · R2 8–9 AM
  - Lunch:     R1 12–1 PM · R2 1–2 PM
  - Dinner:    R1 7–8 PM · R2 8–9 PM
- **Cutoffs** (configured in `app_settings.cutoffs`, evaluated server-side via `cutoff_for(meal, date)`):
  - Breakfast — previous night 23:59 IST
  - Lunch     — same day 10:00 IST
  - Dinner    — same day 15:00 IST

## Database

Tables (all with RLS, all in `supabase_realtime` publication):

| Table | Purpose |
| --- | --- |
| `menu_items` | Catalogue. Authenticated read, admin manage. |
| `orders` | One row per order. `user_id`, `meal_type`, `delivery_date`, `delivery_window`, `status`, `prep_status`, `subtotal`, `total`, `address`, `lat`, `lng`, `delivery_otp`, `batch_id`, `rider_id`. |
| `order_items` | Snapshot of items at time of placement (`name`, `size`, `price`, `qty`). |
| `order_events` | Append-only audit trail (`status`, `actor_id`, `note`). |
| `deliveries` | Rider assignment + delivery lifecycle (`assigned → picked_up → en_route → arrived → delivered/failed`). |
| `kitchen_batches` | Groups orders for prep + dispatch by `(date, meal, round)`. |
| `wallets`, `wallet_transactions` | Money flow — debited on place, credited on cancel. |

Enums: `meal_type`, `menu_size`, `delivery_window`, `order_status` (`placed | preparing | out_for_delivery | delivered | cancelled`), `delivery_status`.

## RLS summary

- `orders` — customer read/insert their own; admin read all + update; no delete.
- `order_items` — readable/insertable by order owner; admin read.
- `order_events` — readable by order owner + admin; only admins (and SECURITY DEFINER RPCs) insert.
- `deliveries` — order owner + admin read; rider can update own deliveries.
- `wallets` / `wallet_transactions` — owner read; mutations only via SECURITY DEFINER RPCs (`place_order`, `cancel_order_with_refund`, `admin_*`).

## Server-side RPCs (single source of truth for state changes)

All defined `SECURITY DEFINER`, `search_path = public`.

| RPC | Caller | Behaviour |
| --- | --- | --- |
| `cutoff_for(meal, date)` | server | Returns the timestamp after which orders for `(meal, date)` are locked. |
| `place_order(meal, date, window, address, lat, lng, items, notes)` | customer | Validates auth + cart + cutoff + address, recomputes `total` from items (server is source of truth), locks wallet row, debits balance, inserts `orders` + `order_items` + `wallet_transactions` + `order_events`, queues `order_confirmed` notification, raises `low_balance` if needed. Returns `order_id`. |
| `cancel_order_with_refund(order_id, reason)` | customer / admin | Customer can self-cancel only before cutoff; admin any time before delivered. Locks wallet, refunds full `total`, marks `cancelled`, audit + notification. Idempotent. |
| `lock_orders_past_cutoff()` | cron (`/api/public/hooks/lock-orders`) | Bulk transitions `placed → preparing` for any order past its cutoff every 5 min. |
| `kitchen_*` | admin | Batch creation, prep status, dispatch (sets order to `out_for_delivery` and creates `deliveries` rows). |
| `rider_update_delivery` / `verify_delivery_otp` | rider | Mirrors delivery status into `orders.status`; OTP gate on `delivered`. |

Errors are short codes: `not_authenticated`, `cart_empty`, `cutoff_passed`, `invalid_address`, `insufficient_balance`, `order_not_found`, `forbidden`, `cutoff_passed_no_self_cancel`, `invalid_otp`. The UI maps these to user-friendly toasts.

## Client architecture

```
src/lib/meals.ts            # Cutoff math + labels (mirrors server cutoff_for)
src/lib/cart.ts             # Zustand cart store (single-meal cart)
src/hooks/use-orders.ts     # useOrders() + useOrder(id) — realtime
src/hooks/use-wallet.ts     # Wallet balance + ledger (realtime)
src/routes/app.index.tsx    # Home — meal tiles with live cutoff state
src/routes/app.menu.tsx     # Menu per meal, add/qty controls
src/routes/app.cart.tsx     # Round picker + cutoff countdown + place order
src/routes/app.orders.tsx   # Live history (uses useOrders)
src/routes/app.track.$id.tsx# Live tracking (uses useOrder) + cancel + rating
```

### Realtime channels

| Channel | Tables | Consumer |
| --- | --- | --- |
| `orders:user:{uid}` | `orders` filtered by `user_id` | Customer orders list |
| `order:{id}` | `orders`, `order_events`, `deliveries` filtered by id | Tracking screen |
| `wallet:user:{uid}` | `wallets`, `wallet_transactions`, `payments` | Wallet screen |
| `kitchen:today` | `orders`, `kitchen_batches` | Admin kitchen |
| `orders:admin` | `orders` | Admin orders board |

Hooks register inside `useEffect`, invalidate the matching TanStack Query key on payload, and `removeChannel` on cleanup. Initial state always comes from a REST snapshot — realtime only invalidates.

### Cart + place flow (happy path)

1. User picks a meal on home → routes to `/app/menu?meal=lunch`.
2. `useCart` accumulates items (single meal type — switching meals would be a future feature).
3. `/app/cart` shows cutoff countdown (`CutoffBanner` recomputes every 30 s) and round picker.
4. On **Place order**, client calls `supabase.rpc('place_order', …)`. The RPC is the **only** authority — client validations are UX only.
5. RPC returns `order_id`; client clears cart, navigates to `/app/track/$id`.
6. Realtime stream updates the tracker as kitchen / rider RPCs progress the order.

### Cancellation + refund

`/app/track/$id` shows a Cancel button while `status === 'placed'`. It calls `cancel_order_with_refund` which:

- Locks the order row, returns early if already `cancelled` / `delivered`.
- Enforces cutoff for non-admin callers (`cutoff_passed_no_self_cancel`).
- Locks wallet, credits `total`, writes `wallet_transactions(type=refund)`, appends `order_events`, fires `order_cancelled` notification.

Refunds are atomic with the cancel — no half-state is reachable.

### Admin / kitchen / super-admin surfaces

- `/admin/orders` — operational board (assign rider, cancel, view).
- `/admin/kitchen` — `kitchen_plan`, `kitchen_create_batch`, `kitchen_set_order_prep`, `kitchen_dispatch_batch`.
- `/admin/payments` — UPI verification queue (separate doc).
- `/super` — `super_overview()` KPIs; manages `app_settings.cutoffs` so cutoff times are tunable without redeploy.

## Production checklist

- [x] Wallet debit + order insert atomic (single SECURITY DEFINER RPC, row-level wallet lock).
- [x] Server recomputes `total` from items — client price tampering ignored.
- [x] Cutoff enforced both client-side (UX) and server-side (authoritative).
- [x] `lock_orders_past_cutoff` cron prevents stuck `placed` orders.
- [x] Cancellation refund is atomic and idempotent.
- [x] All money mutations write to `wallet_transactions` for ledger integrity.
- [x] All status changes write to `order_events` for audit.
- [x] Realtime publication includes `orders`, `order_events`, `deliveries`, `wallets`, `wallet_transactions`.
- [x] RLS denies cross-user reads/writes; admin and SECURITY DEFINER paths are the only escape hatches.
- [x] Error codes mapped to friendly toasts; insufficient balance routes to `/app/wallet`.
- [ ] Wire real map provider on `/app/track/$id` (placeholder today).
- [ ] Multi-meal cart (currently single meal at a time — by design for v1).
