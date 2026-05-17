# Kitchen Operations & Dispatch Architecture

Complete operational layer for the tiffin kitchen — preparation, batching,
dispatch, and rider handoff. Built entirely on Supabase + Realtime, no
external job queue or ERP layer.

## Business Model

| Meal      | Items                          | Cutoff           | Rounds          |
|-----------|--------------------------------|------------------|-----------------|
| Breakfast | Fixed plate                    | Previous night   | 7–8AM, 8–9AM    |
| Lunch     | Mini ₹60, Large ₹90            | 10:00 IST        | 12–1PM, 1–2PM   |
| Dinner    | Mini ₹60, Large ₹90            | 15:00 IST        | 7–8PM, 8–9PM    |

Cutoffs and meal pricing are stored in `app_settings` and edited from
`/super/settings` (super admin only).

## Database

Tables driving kitchen ops (already provisioned, RLS-enforced):

- **`orders`** — `prep_status` (`pending|prepping|packed|ready`), `batch_id`,
  `delivery_window`, `delivery_otp`.
- **`order_items`** — sized lines (`mini|large|fixed`) used to compute
  per-batch quantities.
- **`kitchen_batches`** — `delivery_date`, `meal_type`, `round_label`,
  `status` (`planned|packing|ready|dispatched`), `rider_id`,
  `planned_mini/large/breakfast`, `dispatched_at`.
- **`daily_menu_overrides`** — emergency stop/open per meal+date.
- **`deliveries`** — created on dispatch via `assign_delivery()`.

Realtime publication includes `orders`, `kitchen_batches`, `deliveries`,
`riders` so the kitchen dashboard updates without polling.

## RPCs (`SECURITY DEFINER`, gated by `is_admin()`)

| RPC                         | Purpose                                                    |
|-----------------------------|------------------------------------------------------------|
| `kitchen_plan(date,meal)`   | Aggregate KPIs: orders, mini/large/bf totals, prep funnel. |
| `kitchen_today_orders(...)` | Per-order rows with itemised counts + batch link.          |
| `kitchen_create_batch(...)` | Creates batch, sweeps unbatched matching orders into it.   |
| `kitchen_set_batch_status`  | Move batch through `planned→packing→ready→dispatched`.     |
| `kitchen_set_order_prep`    | Per-order prep state machine.                              |
| `kitchen_dispatch_batch`    | Atomic: assign rider, create deliveries, transition orders to `out_for_delivery`, log events. |
| `kitchen_meal_toggle`       | Stop/reopen a meal for a date (writes `daily_menu_overrides`). |
| `verify_delivery_otp`       | Rider-side delivery completion (transitions order to `delivered`). |

Cutoff enforcement runs in `place_order()` via `cutoff_for(meal, date)`,
which reads `app_settings.cutoffs`. Past-cutoff sweeping is handled by
`lock_orders_past_cutoff()` (cron-callable).

## Hooks (`src/hooks/use-kitchen.ts`)

- `useKitchenPlan(date, meal)` — KPI dashboard tiles.
- `useKitchenOrders(date, meal)` — order list with prep buttons.
- `useKitchenBatches(date)` — batch cards.
- `useKitchenRealtime(date)` — single subscription invalidating all
  kitchen queries on relevant `orders / kitchen_batches / deliveries` events.
- Mutations: `useSetOrderPrep`, `useCreateBatch`, `useSetBatchStatus`,
  `useDispatchBatch`, `useMealToggle`.

All queries are keyed by `[domain, date, meal]` so React Query dedupes
across components.

## Dashboard (`/admin/kitchen`)

Single-screen ops console:

1. **Header** — date picker + meal filter + manual refresh.
2. **KPIs** — orders, breakfast, mini, large, pending, packed, unbatched.
3. **Meal availability** — emergency stop/open per meal.
4. **Batches** — per-meal "+ create" buttons; each batch shows planned
   counts and a single-tap **Dispatch** action that picks a rider.
5. **Orders** — full list with prep state buttons (Prep / Pack / Ready)
   and batch tag.

Realtime keeps every section live; mutations optimistically invalidate
the affected query keys.

## Operational Flow

```text
   place_order ──► orders(prep=pending, batch=null)
                          │
              kitchen_create_batch(meal, round)
                          ▼
   orders.batch_id set ──► kitchen_batches(planned)
                          │
              kitchen_set_order_prep ─┐
                                      ▼
   orders.prep_status: pending → prepping → packed → ready
                          │
              kitchen_dispatch_batch(rider)
                          ▼
   deliveries(assigned) + orders.status = out_for_delivery
                          │
              rider_update_delivery / verify_delivery_otp
                          ▼
   orders.status = delivered, wallet ledger frozen
```

## Security

- All mutations are RPCs with `is_admin(auth.uid())` checks (or
  rider-self checks for `verify_delivery_otp`).
- RLS on `kitchen_batches`: admin manage, riders read their own batch.
- RLS on `deliveries`: admin manage, riders update their own,
  customers read deliveries for their own orders.
- Wallet impact (refunds on cancel) handled server-side in
  `cancel_order_with_refund` — kitchen UI never touches wallet tables.

## Extensibility

- **New rounds / windows** — extend `delivery_window` enum and add
  `app_settings.rounds` entries; UI reads them via `useQuery(['app_settings'])`.
- **Locality-based batching** — extend `kitchen_create_batch` to filter
  by `lat/lng` bounding box or H3 cell stored on `orders`.
- **Auto-batch on cutoff** — schedule `kitchen_create_batch` from
  `lock_orders_past_cutoff` for each `(date, meal, round)` tuple.
- **Rider load balancing** — replace prompt-based dispatch with
  `assign_delivery` round-robin over `riders.online = true`.
