# Analytics & Reporting Architecture

Realtime operational + business intelligence layer for the tiffin platform.
Pure Supabase RPCs + React Query + Recharts — no warehouse, no BI tool.

## Data Sources (existing `SECURITY DEFINER` RPCs)

| RPC                          | Returns                                            |
|------------------------------|----------------------------------------------------|
| `admin_kpis()`               | Live counters: orders today, revenue, OFD, delivered, recharges, refunds, riders online/active, customers. |
| `admin_daily_series(p_days)` | Per-day orders + revenue (trend lines).            |
| `admin_meal_mix(p_days)`     | Breakfast/lunch/dinner orders + revenue split.     |
| `admin_top_customers(p_days,p_limit)` | Spend leaderboard.                        |
| `admin_rider_performance(p_days)` | Delivered, failed, avg minutes per rider.     |
| `admin_growth_kpis()`        | Active/inactive, referrals, ratings, loyalty.      |
| `admin_support_kpis()`       | Open / urgent / resolved / avg resolution hrs.     |
| `super_overview()`           | GMV 30d/lifetime, orders, customers active, wallet float, recharges/refunds, admins, riders. |

All gated by `is_admin(auth.uid())` (or `has_role('super_admin')` for
`super_overview`). RLS on the underlying tables is preserved — RPCs only
expose aggregates.

## Hooks (`src/hooks/use-analytics.ts`)

- `useAdminKpis(refetchMs=30000)` — auto-refreshing live tiles.
- `useDailySeries(days)` / `useMealMix(days)` — chart data.
- `useTopCustomers(days, limit)` / `useRiderPerformance(days)`.
- `useGrowthKpis()` / `useSupportKpis()` / `useSuperOverview()` — 60s poll.
- `useAnalyticsRealtime()` — single Supabase channel subscribed to
  `orders`, `wallet_transactions`, `deliveries`. On any change it
  invalidates the `["analytics", …]` query family so charts and KPIs
  re-render without manual refresh.

Query keys are namespaced under `"analytics"` so a single
`qc.invalidateQueries({ queryKey: ["analytics"] })` flushes everything.

## Dashboards

### `/admin/analytics` (full BI view)

Layout:

1. **Header** — date-range pills (7 / 14 / 30 days).
2. **Live KPIs** — 6 tiles (orders today, revenue today, OFD, delivered,
   recharges today, customers).
3. **Trend** — revenue area chart + orders bar chart side-by-side.
4. **Mix + Riders** — meal mix donut + 7-day rider performance list.
5. **Customers + Growth/Support** — top 8 customers table + compact
   growth and support stat grids.

### `/admin` (operational dashboard, already shipped)

Live order funnel, recharge/refund counters, today's series — the
"war room" view for live ops.

### `/super` (executive overview)

GMV, customers active 30d, wallet float, admin and rider counts via
`super_overview()`.

## Realtime Strategy

- **Live counters (`admin_kpis`)**: 30s `refetchInterval` + realtime
  invalidation on `orders` / `wallet_transactions`. The 30s floor
  protects DB load if many admins are connected; realtime makes
  important deltas (new order placed, rider dispatched) visible
  in <2s.
- **Trend charts**: invalidated on `orders` change but cached aggressively
  by query key (`["analytics", "daily", days]`).
- **Per-page channels**: `useAnalyticsRealtime` mounts one channel per
  dashboard, removed on unmount — avoids subscription leaks.

## Performance / Scale Notes

- All RPCs are `STABLE SECURITY DEFINER` and use indexed columns
  (`delivery_date`, `created_at`). At ~10k orders/day they remain <100ms.
- For >50k orders/day, swap `admin_daily_series` and `admin_meal_mix`
  for materialized views refreshed every 5 min via `pg_cron`:
  ```sql
  create materialized view mv_daily_orders as
    select delivery_date, count(*) orders, sum(total) revenue
    from orders where status <> 'cancelled' group by delivery_date;
  refresh materialized view concurrently mv_daily_orders;
  ```
  Replace the RPC body with a `select` from the MV — hooks stay unchanged.
- Recharts is rendered inside `ResponsiveContainer` for fluid resize;
  no virtualization needed at typical operational data sizes (≤90 days).

## Filtering

- Time range: client-side state `7 | 14 | 30` passed as `p_days`.
- Meal filter: reuse `kitchen_today_orders(p_meal)` for ops; analytics
  RPCs accept day windows. To add meal/rider/round filters globally,
  extend RPC signatures with optional `p_meal meal_type` / `p_rider_id`
  parameters and thread them through the hook signatures.

## Reporting / Export

For CSV exports, call any RPC from a server function (`createServerFn`)
and stream `text/csv`. The `requireSupabaseAuth` middleware preserves
admin RLS, so the same `is_admin()` check applies.

## Extensibility

- Add a new KPI: extend `admin_kpis()`'s `jsonb_build_object`, type it
  in `AdminKpis`, drop a `<Kpi/>` tile in.
- Add a new chart: write a small RPC + a `useQuery` hook + Recharts
  block — no infra changes needed.
- Cohort retention / funnel: add a dedicated `admin_cohorts(p_weeks)`
  RPC returning `(week, signups, returned_w1, returned_w4)` and render
  with Recharts `<LineChart>`.
