# Realtime Rider Tracking & Delivery Operations

Stack: TanStack Start v1 · React 19 · Supabase (Postgres + RLS + Realtime) · TypeScript · Vite 7. **No** Next.js / NestJS / Prisma / Redis / Socket.IO / Docker.

## Business model

- Own riders only (no third-party logistics).
- Round-based dispatch: Breakfast (R1 7–8 / R2 8–9), Lunch (R1 12–1 / R2 1–2), Dinner (R1 7–8 / R2 8–9).
- Customer tracking experience modelled on Zomato/Swiggy: live rider pin, distance, ETA, OTP at the door.

## Database

| Table | Purpose |
| --- | --- |
| `riders` | Master record. `name`, `phone`, `user_id` (auth link), `active`, `online`, `current_lat`, `current_lng`, `last_seen_at`. `REPLICA IDENTITY FULL`, in `supabase_realtime`. |
| `deliveries` | One row per order delivery. `order_id`, `rider_id`, `status` (`assigned → picked_up → en_route → arrived → delivered/failed`), `picked_up_at`, `arrived_at`, `delivered_at`, `failed_reason`, `route_index`. Realtime-enabled. |
| `kitchen_batches` | Groups orders for prep + dispatch by `(date, meal, round)`. Holds `rider_id`, `status` (`planned → packing → ready → dispatched`). |
| `orders` | Mirrors `status` from delivery progress (`out_for_delivery`, `delivered`). Carries `delivery_otp`, `lat`, `lng`, `rider_id`. |

Enums: `delivery_status`, `order_status`, `meal_type`, `delivery_window`.

## RLS

- `riders` — authenticated `SELECT`, admin manage, rider can `UPDATE` own row (`user_id = auth.uid()`).
- `deliveries` — admin manage, rider `UPDATE` own deliveries, customers read own via `orders` join.
- `kitchen_batches` — admin manage, rider read own batches.
- All money / status mutations go through SECURITY DEFINER RPCs.

## SECURITY DEFINER RPCs

| RPC | Caller | Behaviour |
| --- | --- | --- |
| `set_rider_online(p_online)` | rider | Toggles `riders.online`, stamps `last_seen_at`. |
| `rider_heartbeat(p_lat, p_lng)` | rider | Pushes current GPS into `riders.current_lat/lng`, stamps `last_seen_at`. Triggers realtime broadcast to every customer subscribed to that rider. |
| `assign_delivery(order_id, rider_id)` | admin | Idempotent — creates or re-points the active `deliveries` row, mirrors `rider_id` onto the order, appends `order_events`. |
| `kitchen_dispatch_batch(batch_id, rider_id)` | admin | For every non-terminal order in the batch: assigns delivery, flips order to `out_for_delivery`, appends event. Returns count. |
| `rider_update_delivery(delivery_id, status, lat?, lng?, reason?)` | rider / admin | Atomic delivery transition. Mirrors lifecycle into `orders.status`, captures GPS opportunistically, appends `order_events`, locks rider ownership via `EXISTS(riders.user_id = auth.uid())`. |
| `verify_delivery_otp(delivery_id, otp)` | rider | Compares `orders.delivery_otp`, raises `invalid_otp` on mismatch, otherwise calls `rider_update_delivery(..., 'delivered')`. **OTP is the only path to `delivered`.** |
| `link_rider_to_phone(rider_id, phone)` | admin | Links a rider record to an existing auth user by phone, grants `rider` role. |

Failure codes: `forbidden`, `delivery_not_found`, `invalid_otp`, `no_user_with_that_phone`. Mapped to friendly toasts client-side.

## Realtime channel strategy

| Channel | Subscribed tables / filters | Consumer |
| --- | --- | --- |
| `order:{orderId}` | `orders id=eq`, `order_events order_id=eq`, `deliveries order_id=eq` | Customer tracking screen — invalidates the order query. |
| `rider-pos:{riderId}` | `riders id=eq` (UPDATE only) | Customer tracking screen — patches in-memory rider position without a refetch. |
| `rider:{riderId}` | `deliveries rider_id=eq` | Rider dashboard — invalidates the deliveries list when a new one is assigned or a status changes. |
| `orders:admin` (planned) | `orders` + `deliveries` | Admin operations board. |
| `kitchen:today` | `orders`, `kitchen_batches` filtered by today | Admin kitchen dashboard. |

Hooks register inside `useEffect`, hydrate from a REST snapshot, then patch on payloads, and `removeChannel` on cleanup. Realtime is for **invalidation/patches only** — the source of truth is always Postgres.

## Client architecture

```
src/hooks/use-rider-location.ts   # useRiderLocation(riderId) — live { lat, lng, name, phone, lastSeenAt }
                                   # distanceMeters(a,b) + etaMinutes(m) helpers
src/hooks/use-orders.ts           # useOrder(id) — order + items + events + rider, realtime
src/components/customer/LiveTrackCard.tsx
                                   # Stylised mini-map (SVG, no map deps), pulsing rider pin,
                                   # drop pin, live distance + ETA badges, "Live / Signal weak / Offline"
                                   # status, Call rider, Open in Google Maps.
src/routes/app.track.$id.tsx      # Customer tracking screen
src/routes/rider.tsx              # Rider shell — heartbeat every 20s while online via rider_heartbeat
src/routes/rider.index.tsx        # Active route + completed today, realtime deliveries
src/routes/rider.d.$id.tsx        # Per-delivery: pickup → en route → arrived → OTP verify / fail
src/routes/admin.kitchen.tsx      # Kitchen plan + batch dispatch
src/routes/admin.riders.tsx       # Rider master + link-to-account
```

### Rider-side realtime location pipeline

1. Rider toggles **Online** → `set_rider_online(true)`.
2. The `RiderLayout` `useEffect` detects `rider.online === true` and starts a 20 s `setInterval` calling `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy`.
3. Every tick fires `supabase.rpc('rider_heartbeat', { p_lat, p_lng })`.
4. The RPC `UPDATE`s `riders` → Postgres replication → Supabase Realtime → every `rider-pos:{riderId}` channel currently subscribed.
5. The customer's `useRiderLocation` patches local state → `LiveTrackCard` recomputes distance + ETA → SVG rider pin animates to the new coordinate.

Toggle off ⇒ heartbeat stops, `lastSeenAt` ages out, customer sees **Signal weak** after 60 s.

### Customer tracking experience

- **Always-on stream**: `useOrder(id)` invalidates on any `orders / order_events / deliveries` change for that id; `useRiderLocation` streams position as soon as `order.rider_id` is non-null.
- **Distance + ETA**: Haversine in `distanceMeters`, ETA assumes 22 km/h average urban scooter speed (conservative).
- **Trust signals**: live "Live / Signal weak / Offline" pill, animated pulse on rider pin, dashed route line.
- **Handoff**: Call rider (uses `riders.phone` from the realtime payload, never leaks a customer phone), Open in Google Maps for last-leg navigation.
- **OTP visibility**: 4-digit OTP shown prominently on the tracker — generated server-side at order placement, stored on `orders.delivery_otp`, only readable by the order's owner via RLS.

### Rider operational UX

- **One-tap state machine**: Confirm pickup → Start delivery → Mark arrived → OTP. Each tap calls `rider_update_delivery` and opportunistically attaches GPS.
- **Failure path**: Quick-pick reasons (Customer unreachable, Wrong address, OTP failed, Other) + freeform text → `rider_update_delivery(..., 'failed', reason)`. Order does **not** auto-refund — admin reviews and uses `cancel_order_with_refund` if appropriate.
- **Reconnect-safe**: All actions are idempotent or guarded (delivered/failed are terminal in `rider_update_delivery`). Lost network ⇒ retry button; the next `rider_heartbeat` tick re-establishes the realtime channel.

## Production checklist

- [x] `riders` in `supabase_realtime` with `REPLICA IDENTITY FULL`.
- [x] `deliveries`, `orders`, `order_events`, `kitchen_batches` in realtime publication.
- [x] OTP is the **only** path to `delivered` (server-enforced in `verify_delivery_otp`).
- [x] Rider `UPDATE` policy gated by `riders.user_id = auth.uid()`; ownership re-checked inside every state-mutating RPC.
- [x] Customer cannot read other customers' delivery rows (RLS join via `orders`).
- [x] Heartbeat throttled to 20 s with `maximumAge: 15s` to spare battery.
- [x] Customer hook hydrates from REST first, then streams — no flash of empty state on reconnect.
- [x] ETA + distance computed client-side from realtime data — no extra round-trips.
- [x] LiveTrackCard renders without external map deps (SVG mini-map). Drop-in replacement with Mapbox/Leaflet later is a single component swap.
- [x] Stale-signal indicator after 60 s of no heartbeat.
- [ ] Future: rider route optimisation (`deliveries.route_index` already in schema).
- [ ] Future: replace SVG mini-map with Mapbox / Maplibre for tile-based rendering.
- [ ] Future: push notifications when rider transitions to `arrived` (today: in-app + WhatsApp via `notify_user`).
