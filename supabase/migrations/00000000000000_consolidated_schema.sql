
-- Enums
create type public.app_role as enum ('super_admin', 'admin', 'rider', 'customer');
create type public.meal_type as enum ('breakfast', 'lunch', 'dinner');
create type public.meal_size as enum ('mini', 'large', 'fixed');
create type public.delivery_window as enum ('round_1', 'round_2');
create type public.order_status as enum ('placed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled');
create type public.wallet_tx_type as enum ('topup', 'order_debit', 'refund', 'adjustment');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  address text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Roles (separate table, never on profiles)
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin','super_admin')
  )
$$;

-- Wallet
create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type wallet_tx_type not null,
  amount numeric(10,2) not null,
  balance_after numeric(10,2) not null,
  description text,
  reference_id uuid,
  created_at timestamptz not null default now()
);
alter table public.wallet_transactions enable row level security;
create index on public.wallet_transactions (user_id, created_at desc);

-- Menu
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  meal_type meal_type not null,
  size meal_size not null,
  name text not null,
  description text,
  price numeric(10,2) not null,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.menu_items enable row level security;

-- Orders
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_type meal_type not null,
  delivery_date date not null,
  delivery_window delivery_window not null,
  status order_status not null default 'placed',
  subtotal numeric(10,2) not null,
  total numeric(10,2) not null,
  address text not null,
  lat double precision,
  lng double precision,
  delivery_otp text,
  rider_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders enable row level security;
create index on public.orders (user_id, created_at desc);
create index on public.orders (delivery_date, meal_type);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id),
  name text not null,
  size meal_size not null,
  qty integer not null default 1,
  price numeric(10,2) not null
);
alter table public.order_items enable row level security;
create index on public.order_items (order_id);

-- Riders
create table public.riders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  phone text,
  active boolean not null default true,
  current_lat double precision,
  current_lng double precision,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.riders enable row level security;

-- Deliveries
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  rider_id uuid references public.riders(id) on delete set null,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  route_index integer,
  created_at timestamptz not null default now()
);
alter table public.deliveries enable row level security;

-- Triggers
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.phone);
  insert into public.wallets (user_id, balance) values (new.id, 0);
  insert into public.user_roles (user_id, role) values (new.id, 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
for each row execute function public.touch_updated_at();

-- ===== RLS Policies =====

-- profiles
create policy "profile self read" on public.profiles for select using (auth.uid() = id or public.is_admin(auth.uid()));
create policy "profile self update" on public.profiles for update using (auth.uid() = id);
create policy "profile self insert" on public.profiles for insert with check (auth.uid() = id);

-- user_roles
create policy "roles self read" on public.user_roles for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "roles super manage" on public.user_roles for all
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

-- wallets
create policy "wallet self read" on public.wallets for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "wallet admin update" on public.wallets for update using (public.is_admin(auth.uid()));

-- wallet_transactions
create policy "wtx self read" on public.wallet_transactions for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "wtx admin insert" on public.wallet_transactions for insert with check (public.is_admin(auth.uid()) or auth.uid() = user_id);

-- menu_items
create policy "menu read all" on public.menu_items for select using (auth.role() = 'authenticated');
create policy "menu admin manage" on public.menu_items for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- orders
create policy "orders self read" on public.orders for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "orders self insert" on public.orders for insert with check (auth.uid() = user_id);
create policy "orders admin update" on public.orders for update using (public.is_admin(auth.uid()) or auth.uid() = user_id);

-- order_items
create policy "items self read" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin(auth.uid())))
);
create policy "items self insert" on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);

-- riders
create policy "riders read auth" on public.riders for select using (auth.role() = 'authenticated');
create policy "riders admin manage" on public.riders for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- deliveries
create policy "deliveries self read" on public.deliveries for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin(auth.uid())))
);
create policy "deliveries admin manage" on public.deliveries for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Seed menu
insert into public.menu_items (meal_type, size, name, description, price) values
  ('breakfast','fixed','Aloo Paratha Combo','2 stuffed paranthas, curd, pickle', 50),
  ('lunch','mini','Mini Thali','3 roti, dal, sabzi, rice, salad', 60),
  ('lunch','large','Large Thali','5 roti, dal, sabzi, rice, raita, sweet', 90),
  ('dinner','mini','Mini Thali','3 roti, dal, sabzi, rice, salad', 60),
  ('dinner','large','Large Thali','5 roti, dal, sabzi, rice, raita, sweet', 90);

alter function public.handle_new_user() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.is_admin(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- ENUMS
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('upi_qr','cash','admin_credit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending','success','failed','reversed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notify_channel AS ENUM ('whatsapp','sms','push','in_app'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ORDER EVENTS
CREATE TABLE public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  status order_status NOT NULL,
  actor_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.order_events (order_id, created_at);
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_events self read" ON public.order_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_events.order_id AND (o.user_id = auth.uid() OR is_admin(auth.uid()))));
CREATE POLICY "order_events admin insert" ON public.order_events FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

-- PAYMENTS
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  qr_payload text,
  utr_reference text,
  verified_by uuid,
  verified_at timestamptz,
  invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payments (user_id, status, created_at);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments self read" ON public.payments FOR SELECT
  USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY "payments self insert" ON public.payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "payments admin update" ON public.payments FOR UPDATE
  USING (is_admin(auth.uid()));
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- INVOICES
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text UNIQUE NOT NULL,
  user_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.invoices (user_id, created_at);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices self read" ON public.invoices FOR SELECT
  USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY "invoices admin manage" ON public.invoices FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- NOTIFICATION LOG
CREATE TABLE public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  channel notify_channel NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.notification_log (user_id, created_at);
CREATE INDEX ON public.notification_log (status, created_at);
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif self read" ON public.notification_log FOR SELECT
  USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY "notif admin manage" ON public.notification_log FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- AUDIT LOG
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_log (actor_id, created_at);
CREATE INDEX ON public.audit_log (action, created_at);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit super read" ON public.audit_log FOR SELECT
  USING (has_role(auth.uid(), 'super_admin'));
CREATE POLICY "audit admin insert" ON public.audit_log FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

-- OTP REQUESTS (server-only; no policies = no public access since RLS on)
CREATE TABLE public.otp_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  purpose text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.otp_requests (phone, purpose, created_at);
ALTER TABLE public.otp_requests ENABLE ROW LEVEL SECURITY;

-- APP SETTINGS
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings read auth" ON public.app_settings FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "settings super manage" ON public.app_settings FOR ALL
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- DAILY MENU OVERRIDES
CREATE TABLE public.daily_menu_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  meal_type meal_type NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, meal_type)
);
ALTER TABLE public.daily_menu_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menu overrides read auth" ON public.daily_menu_overrides FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "menu overrides admin manage" ON public.daily_menu_overrides FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
-- user_sessions table for device/session tracking
create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  device_label text,
  user_agent text,
  ip text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_user_sessions_user on public.user_sessions(user_id) where revoked_at is null;

alter table public.user_sessions enable row level security;

create policy "sessions self read"
  on public.user_sessions for select
  using (auth.uid() = user_id or is_admin(auth.uid()));

create policy "sessions self insert"
  on public.user_sessions for insert
  with check (auth.uid() = user_id);

create policy "sessions self update"
  on public.user_sessions for update
  using (auth.uid() = user_id or is_admin(auth.uid()));

-- record a fresh session row on login
create or replace function public.record_session(p_device_label text, p_user_agent text, p_ip text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.user_sessions (user_id, device_label, user_agent, ip)
  values (auth.uid(), p_device_label, p_user_agent, p_ip)
  returning id into v_id;
  return v_id;
end;
$$;

-- revoke a session
create or replace function public.revoke_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_sessions
  set revoked_at = now()
  where id = p_session_id
    and (user_id = auth.uid() or is_admin(auth.uid()));
end;
$$;

-- heartbeat
create or replace function public.touch_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_sessions
  set last_seen_at = now()
  where id = p_session_id and user_id = auth.uid() and revoked_at is null;
end;
$$;revoke execute on function public.record_session(text, text, text) from public, anon;
revoke execute on function public.revoke_session(uuid) from public, anon;
revoke execute on function public.touch_session(uuid) from public, anon;
grant execute on function public.record_session(text, text, text) to authenticated;
grant execute on function public.revoke_session(uuid) to authenticated;
grant execute on function public.touch_session(uuid) to authenticated;-- Index for live order feeds (status + recency)
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_orders_delivery on public.orders(delivery_date, meal_type, delivery_window);

-- Default operational settings
insert into public.app_settings(key, value)
values
  ('cutoffs', '{"breakfast_prev_night_hour":23,"lunch_hour":10,"dinner_hour":15}'::jsonb),
  ('rounds', '{"breakfast":["07:00-08:00","08:00-09:00"],"lunch":["12:00-13:00","13:00-14:00"],"dinner":["19:00-20:00","20:00-21:00"]}'::jsonb),
  ('pricing', '{"mini":60,"large":90}'::jsonb)
on conflict (key) do nothing;

-- Compute cutoff timestamp for a given meal+date (in IST = UTC+5:30)
create or replace function public.cutoff_for(p_meal meal_type, p_date date)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  ist_offset interval := interval '5 hours 30 minutes';
begin
  select value into v from public.app_settings where key = 'cutoffs';
  if p_meal = 'breakfast' then
    -- previous-night cutoff at configured hour IST the day before delivery
    return ((p_date - 1)::timestamp + (coalesce((v->>'breakfast_prev_night_hour')::int, 23) || ' hours')::interval) - ist_offset;
  elsif p_meal = 'lunch' then
    return (p_date::timestamp + (coalesce((v->>'lunch_hour')::int, 10) || ' hours')::interval) - ist_offset;
  else
    return (p_date::timestamp + (coalesce((v->>'dinner_hour')::int, 15) || ' hours')::interval) - ist_offset;
  end if;
end;
$$;

-- Atomic order placement
create or replace function public.place_order(
  p_meal meal_type,
  p_delivery_date date,
  p_window delivery_window,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_items jsonb,           -- [{name, size, price, qty}]
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_total numeric := 0;
  v_balance numeric;
  v_order_id uuid;
  v_otp text;
  v_item jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'cart_empty';
  end if;
  if now() > public.cutoff_for(p_meal, p_delivery_date) then
    raise exception 'cutoff_passed';
  end if;
  if coalesce(length(trim(p_address)), 0) < 5 then
    raise exception 'invalid_address';
  end if;

  -- Compute total from items
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'price')::numeric * (v_item->>'qty')::int;
  end loop;

  -- Lock + check wallet balance atomically
  select balance into v_balance from public.wallets where user_id = v_uid for update;
  if v_balance is null then
    insert into public.wallets(user_id, balance) values (v_uid, 0);
    v_balance := 0;
  end if;
  if v_balance < v_total then
    raise exception 'insufficient_balance';
  end if;

  v_otp := lpad((floor(random() * 10000))::text, 4, '0');

  insert into public.orders(
    user_id, meal_type, delivery_date, delivery_window, status,
    subtotal, total, address, lat, lng, delivery_otp, notes
  ) values (
    v_uid, p_meal, p_delivery_date, p_window, 'placed',
    v_total, v_total, p_address, p_lat, p_lng, v_otp, p_notes
  ) returning id into v_order_id;

  insert into public.order_items(order_id, name, size, price, qty)
  select v_order_id, x->>'name', (x->>'size')::menu_size, (x->>'price')::numeric, (x->>'qty')::int
  from jsonb_array_elements(p_items) x;

  -- Debit wallet
  update public.wallets set balance = balance - v_total, updated_at = now() where user_id = v_uid;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  values (v_uid, 'order_debit', -v_total, v_balance - v_total,
          (initcap(p_meal::text) || ' order'), v_order_id);

  insert into public.order_events(order_id, status, actor_id, note)
  values (v_order_id, 'placed', v_uid, 'Order placed');

  insert into public.notification_log(user_id, channel, template, payload, status)
  values (v_uid, 'whatsapp', 'order_confirmed',
          jsonb_build_object('order_id', v_order_id, 'meal', p_meal, 'total', v_total),
          'queued');

  return v_order_id;
end;
$$;

-- Cancel + refund (idempotent on already-cancelled)
create or replace function public.cancel_order_with_refund(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_balance numeric;
  v_is_admin boolean := public.is_admin(v_uid);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.user_id <> v_uid and not v_is_admin then
    raise exception 'forbidden';
  end if;
  if v_order.status in ('cancelled', 'delivered') then
    return; -- idempotent
  end if;

  -- Customers can only cancel before cutoff; admins override anytime
  if not v_is_admin and now() > public.cutoff_for(v_order.meal_type, v_order.delivery_date) then
    raise exception 'cutoff_passed_no_self_cancel';
  end if;

  update public.orders
  set status = 'cancelled', updated_at = now()
  where id = p_order_id;

  insert into public.order_events(order_id, status, actor_id, note)
  values (p_order_id, 'cancelled', v_uid, coalesce(p_reason, 'Cancelled'));

  -- Refund to wallet
  select balance into v_balance from public.wallets where user_id = v_order.user_id for update;
  if v_balance is null then
    insert into public.wallets(user_id, balance) values (v_order.user_id, 0);
    v_balance := 0;
  end if;
  update public.wallets set balance = balance + v_order.total, updated_at = now()
    where user_id = v_order.user_id;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  values (v_order.user_id, 'refund', v_order.total, v_balance + v_order.total,
          'Refund for cancelled order', p_order_id);

  insert into public.notification_log(user_id, channel, template, payload, status)
  values (v_order.user_id, 'whatsapp', 'order_cancelled',
          jsonb_build_object('order_id', p_order_id, 'reason', p_reason, 'refund', v_order.total),
          'queued');
end;
$$;

-- Auto-lock orders past cutoff: 'placed' -> 'preparing' (kitchen takeover).
-- Returns count of orders moved.
create or replace function public.lock_orders_past_cutoff()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with locked as (
    update public.orders o
    set status = 'preparing', updated_at = now()
    where o.status = 'placed'
      and now() > public.cutoff_for(o.meal_type, o.delivery_date)
    returning id
  )
  select count(*) into v_count from locked;

  insert into public.order_events(order_id, status, note)
  select id, 'preparing', 'Auto-locked at cutoff' from public.orders
  where status = 'preparing' and updated_at >= now() - interval '1 minute'
    and not exists (
      select 1 from public.order_events e
      where e.order_id = orders.id and e.status = 'preparing'
    );

  return v_count;
end;
$$;

-- Lock down execute permissions
revoke execute on function public.cutoff_for(meal_type, date) from public, anon;
revoke execute on function public.place_order(meal_type, date, delivery_window, text, double precision, double precision, jsonb, text) from public, anon;
revoke execute on function public.cancel_order_with_refund(uuid, text) from public, anon;
revoke execute on function public.lock_orders_past_cutoff() from public, anon;

grant execute on function public.cutoff_for(meal_type, date) to authenticated;
grant execute on function public.place_order(meal_type, date, delivery_window, text, double precision, double precision, jsonb, text) to authenticated;
grant execute on function public.cancel_order_with_refund(uuid, text) to authenticated;
grant execute on function public.lock_orders_past_cutoff() to authenticated, service_role;
-- delivery status enum
do $$ begin
  create type public.delivery_status as enum ('assigned','picked_up','en_route','arrived','delivered','failed');
exception when duplicate_object then null; end $$;

alter table public.deliveries
  add column if not exists status public.delivery_status not null default 'assigned',
  add column if not exists arrived_at timestamptz,
  add column if not exists failed_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.riders
  add column if not exists online boolean not null default false;

create index if not exists idx_deliveries_rider_status on public.deliveries(rider_id, status);
create index if not exists idx_deliveries_order on public.deliveries(order_id);

-- Rider self-update of own row (location/online) when riders.user_id matches auth.uid
drop policy if exists "riders self update" on public.riders;
create policy "riders self update" on public.riders
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Deliveries: rider can update own row's status/timestamps
drop policy if exists "deliveries rider update" on public.deliveries;
create policy "deliveries rider update" on public.deliveries
  for update using (
    exists(select 1 from public.riders r where r.id = deliveries.rider_id and r.user_id = auth.uid())
  ) with check (
    exists(select 1 from public.riders r where r.id = deliveries.rider_id and r.user_id = auth.uid())
  );

-- Function: admin assigns an order to a rider (creates delivery row)
create or replace function public.assign_delivery(p_order_id uuid, p_rider_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  -- one active delivery per order
  select id into v_id from public.deliveries where order_id = p_order_id and status <> 'failed' limit 1;
  if v_id is not null then
    update public.deliveries set rider_id = p_rider_id, status = 'assigned', updated_at = now() where id = v_id;
  else
    insert into public.deliveries(order_id, rider_id, status) values (p_order_id, p_rider_id, 'assigned')
    returning id into v_id;
  end if;
  update public.orders set rider_id = p_rider_id, updated_at = now() where id = p_order_id;
  insert into public.order_events(order_id, status, actor_id, note)
  values (p_order_id, (select status from public.orders where id = p_order_id), auth.uid(), 'Rider assigned');
  return v_id;
end $$;

-- Function: rider updates delivery status (and optional location)
create or replace function public.rider_update_delivery(
  p_delivery_id uuid, p_status public.delivery_status,
  p_lat double precision default null, p_lng double precision default null,
  p_reason text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_order uuid; v_rider uuid; v_uid uuid := auth.uid();
begin
  select order_id, rider_id into v_order, v_rider from public.deliveries where id = p_delivery_id for update;
  if v_order is null then raise exception 'delivery_not_found'; end if;
  if not exists(select 1 from public.riders r where r.id = v_rider and r.user_id = v_uid) and not is_admin(v_uid) then
    raise exception 'forbidden';
  end if;

  update public.deliveries
  set status = p_status,
      picked_up_at = case when p_status = 'picked_up' and picked_up_at is null then now() else picked_up_at end,
      arrived_at  = case when p_status = 'arrived'   and arrived_at  is null then now() else arrived_at  end,
      delivered_at= case when p_status = 'delivered' then now() else delivered_at end,
      failed_reason = case when p_status = 'failed' then p_reason else failed_reason end,
      updated_at = now()
  where id = p_delivery_id;

  -- mirror to order status
  if p_status in ('picked_up','en_route','arrived') then
    update public.orders set status = 'out_for_delivery', updated_at = now() where id = v_order and status <> 'delivered';
  elsif p_status = 'delivered' then
    update public.orders set status = 'delivered', updated_at = now() where id = v_order;
  end if;

  insert into public.order_events(order_id, status, actor_id, note)
  values (v_order,
          (select status from public.orders where id = v_order),
          v_uid,
          'Delivery: ' || p_status::text || coalesce(' — '||p_reason,''));

  if p_lat is not null and p_lng is not null and v_rider is not null then
    update public.riders set current_lat = p_lat, current_lng = p_lng, last_seen_at = now() where id = v_rider;
  end if;
end $$;

-- Function: rider verifies customer OTP and completes delivery
create or replace function public.verify_delivery_otp(p_delivery_id uuid, p_otp text)
returns void language plpgsql security definer set search_path=public as $$
declare v_order uuid; v_rider uuid; v_real text; v_uid uuid := auth.uid();
begin
  select d.order_id, d.rider_id, o.delivery_otp
    into v_order, v_rider, v_real
  from public.deliveries d join public.orders o on o.id = d.order_id
  where d.id = p_delivery_id;
  if v_order is null then raise exception 'delivery_not_found'; end if;
  if not exists(select 1 from public.riders r where r.id = v_rider and r.user_id = v_uid) and not is_admin(v_uid) then
    raise exception 'forbidden';
  end if;
  if coalesce(p_otp,'') <> coalesce(v_real,'') then raise exception 'invalid_otp'; end if;
  perform public.rider_update_delivery(p_delivery_id, 'delivered'::public.delivery_status, null, null, null);
end $$;

-- Function: rider sets online/offline
create or replace function public.set_rider_online(p_online boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.riders set online = p_online, last_seen_at = now() where user_id = auth.uid();
end $$;

-- Function: rider streams location (heartbeat)
create or replace function public.rider_heartbeat(p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.riders set current_lat = p_lat, current_lng = p_lng, last_seen_at = now()
  where user_id = auth.uid();
end $$;

revoke all on function public.assign_delivery(uuid,uuid) from public;
revoke all on function public.rider_update_delivery(uuid,public.delivery_status,double precision,double precision,text) from public;
revoke all on function public.verify_delivery_otp(uuid,text) from public;
revoke all on function public.set_rider_online(boolean) from public;
revoke all on function public.rider_heartbeat(double precision,double precision) from public;

grant execute on function public.assign_delivery(uuid,uuid) to authenticated;
grant execute on function public.rider_update_delivery(uuid,public.delivery_status,double precision,double precision,text) to authenticated;
grant execute on function public.verify_delivery_otp(uuid,text) to authenticated;
grant execute on function public.set_rider_online(boolean) to authenticated;
grant execute on function public.rider_heartbeat(double precision,double precision) to authenticated;

-- Realtime
alter publication supabase_realtime add table public.deliveries;
alter publication supabase_realtime add table public.riders;

create or replace function public.link_rider_to_phone(p_rider_id uuid, p_phone text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select id into v_uid from public.profiles where phone = p_phone limit 1;
  if v_uid is null then raise exception 'no_user_with_that_phone'; end if;
  update public.riders set user_id = v_uid, phone = p_phone where id = p_rider_id;
  insert into public.user_roles(user_id, role) values (v_uid, 'rider')
    on conflict do nothing;
  return v_uid;
end $$;
revoke all on function public.link_rider_to_phone(uuid,text) from public;
grant execute on function public.link_rider_to_phone(uuid,text) to authenticated;

-- KPI snapshot for admin dashboard
create or replace function public.admin_kpis()
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v jsonb;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'orders_today',     (select count(*) from orders where delivery_date = today),
    'revenue_today',    coalesce((select sum(total) from orders where delivery_date = today and status <> 'cancelled'), 0),
    'pending',          (select count(*) from orders where delivery_date = today and status in ('placed','preparing')),
    'out_for_delivery', (select count(*) from orders where delivery_date = today and status = 'out_for_delivery'),
    'delivered_today',  (select count(*) from orders where delivery_date = today and status = 'delivered'),
    'cancelled_today',  (select count(*) from orders where delivery_date = today and status = 'cancelled'),
    'failed_today',     (select count(*) from deliveries d join orders o on o.id=d.order_id where o.delivery_date = today and d.status = 'failed'),
    'riders_online',    (select count(*) from riders where online),
    'riders_active',    (select count(*) from riders where active),
    'customers_total',  (select count(*) from profiles),
    'recharges_today',  coalesce((select sum(amount) from wallet_transactions where type = 'recharge' and created_at::date = today), 0),
    'refunds_today',    coalesce((select sum(amount) from wallet_transactions where type = 'refund' and created_at::date = today), 0)
  ) into v;
  return v;
end $$;

-- Daily series for trend chart (orders + revenue)
create or replace function public.admin_daily_series(p_days int default 14)
returns table(day date, orders bigint, revenue numeric) language sql security definer set search_path=public stable as $$
  with days as (
    select generate_series(((now() at time zone 'Asia/Kolkata')::date - (p_days - 1)),
                           (now() at time zone 'Asia/Kolkata')::date, '1 day')::date as day
  )
  select d.day,
         coalesce(count(o.id), 0)::bigint as orders,
         coalesce(sum(case when o.status <> 'cancelled' then o.total else 0 end), 0)::numeric as revenue
  from days d
  left join orders o on o.delivery_date = d.day
  group by d.day order by d.day;
$$;

create or replace function public.admin_meal_mix(p_days int default 7)
returns table(meal_type meal_type, orders bigint, revenue numeric)
language sql security definer set search_path=public stable as $$
  select meal_type,
         count(*)::bigint,
         coalesce(sum(case when status <> 'cancelled' then total else 0 end), 0)::numeric
  from orders
  where delivery_date >= ((now() at time zone 'Asia/Kolkata')::date - (p_days - 1))
  group by meal_type;
$$;

create or replace function public.admin_top_customers(p_days int default 30, p_limit int default 10)
returns table(user_id uuid, full_name text, phone text, orders bigint, spend numeric)
language sql security definer set search_path=public stable as $$
  select o.user_id, p.full_name, p.phone,
         count(*)::bigint as orders,
         coalesce(sum(case when o.status <> 'cancelled' then o.total else 0 end), 0)::numeric as spend
  from orders o
  left join profiles p on p.id = o.user_id
  where o.delivery_date >= ((now() at time zone 'Asia/Kolkata')::date - (p_days - 1))
  group by o.user_id, p.full_name, p.phone
  order by spend desc
  limit p_limit;
$$;

create or replace function public.admin_rider_performance(p_days int default 7)
returns table(rider_id uuid, name text, online boolean, delivered bigint, failed bigint,
              avg_minutes numeric)
language sql security definer set search_path=public stable as $$
  select r.id, r.name, r.online,
         count(*) filter (where d.status = 'delivered')::bigint as delivered,
         count(*) filter (where d.status = 'failed')::bigint as failed,
         coalesce(avg(extract(epoch from (d.delivered_at - d.picked_up_at))/60.0)
                  filter (where d.delivered_at is not null and d.picked_up_at is not null), 0)::numeric as avg_minutes
  from riders r
  left join deliveries d on d.rider_id = r.id and d.created_at >= now() - make_interval(days => p_days)
  group by r.id, r.name, r.online
  order by delivered desc;
$$;

-- Super admin platform overview
create or replace function public.super_overview()
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v jsonb;
begin
  if not has_role(auth.uid(), 'super_admin') then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'gmv_30d',          coalesce((select sum(total) from orders where created_at >= now() - interval '30 days' and status <> 'cancelled'), 0),
    'gmv_lifetime',     coalesce((select sum(total) from orders where status <> 'cancelled'), 0),
    'orders_30d',       (select count(*) from orders where created_at >= now() - interval '30 days'),
    'orders_lifetime',  (select count(*) from orders),
    'customers_total',  (select count(*) from profiles),
    'customers_active_30d', (select count(distinct user_id) from orders where created_at >= now() - interval '30 days'),
    'wallet_balance_total', coalesce((select sum(balance) from wallets), 0),
    'recharges_30d',    coalesce((select sum(amount) from wallet_transactions where type='recharge' and created_at >= now() - interval '30 days'), 0),
    'refunds_30d',      coalesce((select sum(amount) from wallet_transactions where type='refund' and created_at >= now() - interval '30 days'), 0),
    'admins',           (select count(*) from user_roles where role in ('admin','super_admin')),
    'riders',           (select count(*) from riders where active)
  ) into v;
  return v;
end $$;

revoke all on function public.admin_kpis() from public;
revoke all on function public.admin_daily_series(int) from public;
revoke all on function public.admin_meal_mix(int) from public;
revoke all on function public.admin_top_customers(int,int) from public;
revoke all on function public.admin_rider_performance(int) from public;
revoke all on function public.super_overview() from public;

grant execute on function public.admin_kpis() to authenticated;
grant execute on function public.admin_daily_series(int) to authenticated;
grant execute on function public.admin_meal_mix(int) to authenticated;
grant execute on function public.admin_top_customers(int,int) to authenticated;
grant execute on function public.admin_rider_performance(int) to authenticated;
grant execute on function public.super_overview() to authenticated;
-- =========================
-- Notifications schema
-- =========================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text not null,
  body text,
  link text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_read on public.notifications(user_id, read_at);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notif self read" on public.notifications;
create policy "notif self read" on public.notifications
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "notif self update" on public.notifications;
create policy "notif self update" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notif admin insert" on public.notifications;
create policy "notif admin insert" on public.notifications
  for insert with check (public.is_admin(auth.uid()) or auth.uid() = user_id);

-- =========================
-- Notification preferences
-- =========================
create table if not exists public.notification_preferences (
  user_id uuid primary key,
  whatsapp boolean not null default true,
  in_app boolean not null default true,
  low_balance_threshold numeric not null default 100,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "prefs self read" on public.notification_preferences;
create policy "prefs self read" on public.notification_preferences
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "prefs self upsert" on public.notification_preferences;
create policy "prefs self upsert" on public.notification_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists "prefs self update" on public.notification_preferences;
create policy "prefs self update" on public.notification_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- backfill defaults
insert into public.notification_preferences(user_id)
select id from public.profiles
on conflict do nothing;

-- =========================
-- Queue columns on notification_log
-- =========================
alter table public.notification_log
  add column if not exists priority smallint not null default 5,
  add column if not exists scheduled_for timestamptz not null default now(),
  add column if not exists attempts int not null default 0,
  add column if not exists max_attempts int not null default 5,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists to_phone text;

create index if not exists idx_notif_log_dispatch
  on public.notification_log(status, scheduled_for)
  where status in ('queued','retry');

-- =========================
-- Central notify helper
-- =========================
create or replace function public.notify_user(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_payload jsonb default '{}'::jsonb,
  p_channels text[] default array['in_app','whatsapp'],
  p_priority smallint default 5
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pref public.notification_preferences%rowtype;
  v_phone text;
  v_id uuid;
begin
  if p_user_id is null then return null; end if;

  select * into v_pref from public.notification_preferences where user_id = p_user_id;
  if not found then
    insert into public.notification_preferences(user_id) values (p_user_id)
    returning * into v_pref;
  end if;

  if 'in_app' = any(p_channels) and v_pref.in_app then
    insert into public.notifications(user_id, type, title, body, link, payload)
    values (p_user_id, p_type, p_title, p_body, p_link, coalesce(p_payload,'{}'::jsonb))
    returning id into v_id;
  end if;

  if 'whatsapp' = any(p_channels) and v_pref.whatsapp then
    select phone into v_phone from public.profiles where id = p_user_id;
    insert into public.notification_log(
      user_id, channel, template, payload, status, priority, to_phone
    ) values (
      p_user_id, 'whatsapp', p_type,
      coalesce(p_payload,'{}'::jsonb)
        || jsonb_build_object('title', p_title, 'body', p_body, 'link', p_link),
      'queued', p_priority, v_phone
    );
  end if;

  return v_id;
end $$;

-- =========================
-- User-facing helpers
-- =========================
create or replace function public.mark_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications
    set read_at = coalesce(read_at, now())
    where id = p_id and user_id = auth.uid();
end $$;

create or replace function public.mark_all_notifications_read()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with upd as (
    update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null
    returning 1
  )
  select count(*) into v_count from upd;
  return v_count;
end $$;

create or replace function public.unread_notifications_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;

-- =========================
-- Dispatcher helpers
-- =========================
create or replace function public.claim_pending_notifications(p_limit int default 25)
returns setof public.notification_log
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select id from public.notification_log
    where status in ('queued','retry')
      and scheduled_for <= now()
      and channel = 'whatsapp'
    order by priority asc, scheduled_for asc
    limit p_limit
    for update skip locked
  )
  update public.notification_log n
    set status = 'sending',
        attempts = n.attempts + 1,
        last_attempt_at = now()
  from picked
  where n.id = picked.id
  returning n.*;
end $$;

create or replace function public.mark_notification_sent(p_id uuid, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notification_log
    set status = 'sent', sent_at = now(),
        payload = payload || jsonb_build_object('provider', p_meta)
    where id = p_id;
end $$;

create or replace function public.mark_notification_failed(p_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_attempts int; v_max int;
begin
  select attempts, max_attempts into v_attempts, v_max
  from public.notification_log where id = p_id;
  if v_attempts >= v_max then
    update public.notification_log
      set status = 'failed', error = p_error
      where id = p_id;
  else
    update public.notification_log
      set status = 'retry', error = p_error,
          scheduled_for = now() + (power(2, v_attempts) || ' minutes')::interval
      where id = p_id;
  end if;
end $$;

-- restrict dispatcher RPCs to service role only
revoke execute on function public.claim_pending_notifications(int) from anon, authenticated;
revoke execute on function public.mark_notification_sent(uuid, jsonb) from anon, authenticated;
revoke execute on function public.mark_notification_failed(uuid, text) from anon, authenticated;

-- =========================
-- Realtime
-- =========================
alter table public.notifications replica identity full;
do $$ begin
  perform 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications';
  if not found then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- =========================
-- Update existing flows to use notify_user
-- =========================
create or replace function public.place_order(
  p_meal meal_type, p_delivery_date date, p_window delivery_window,
  p_address text, p_lat double precision, p_lng double precision,
  p_items jsonb, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_total numeric := 0;
  v_balance numeric;
  v_order_id uuid;
  v_otp text;
  v_item jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart_empty'; end if;
  if now() > public.cutoff_for(p_meal, p_delivery_date) then raise exception 'cutoff_passed'; end if;
  if coalesce(length(trim(p_address)), 0) < 5 then raise exception 'invalid_address'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'price')::numeric * (v_item->>'qty')::int;
  end loop;

  select balance into v_balance from public.wallets where user_id = v_uid for update;
  if v_balance is null then
    insert into public.wallets(user_id, balance) values (v_uid, 0);
    v_balance := 0;
  end if;
  if v_balance < v_total then raise exception 'insufficient_balance'; end if;

  v_otp := lpad((floor(random() * 10000))::text, 4, '0');

  insert into public.orders(
    user_id, meal_type, delivery_date, delivery_window, status,
    subtotal, total, address, lat, lng, delivery_otp, notes
  ) values (
    v_uid, p_meal, p_delivery_date, p_window, 'placed',
    v_total, v_total, p_address, p_lat, p_lng, v_otp, p_notes
  ) returning id into v_order_id;

  insert into public.order_items(order_id, name, size, price, qty)
  select v_order_id, x->>'name', (x->>'size')::menu_size, (x->>'price')::numeric, (x->>'qty')::int
  from jsonb_array_elements(p_items) x;

  update public.wallets set balance = balance - v_total, updated_at = now() where user_id = v_uid;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  values (v_uid, 'order_debit', -v_total, v_balance - v_total,
          (initcap(p_meal::text) || ' order'), v_order_id);

  insert into public.order_events(order_id, status, actor_id, note)
  values (v_order_id, 'placed', v_uid, 'Order placed');

  perform public.notify_user(
    v_uid, 'order_confirmed',
    'Order confirmed',
    'Your ' || p_meal::text || ' order for ' || to_char(p_delivery_date,'DD Mon') || ' is confirmed.',
    '/app/track/' || v_order_id::text,
    jsonb_build_object('order_id', v_order_id, 'meal', p_meal, 'total', v_total),
    array['in_app','whatsapp'], 3
  );

  -- low balance warning
  if (v_balance - v_total) < coalesce(
       (select low_balance_threshold from public.notification_preferences where user_id = v_uid), 100) then
    perform public.notify_user(
      v_uid, 'low_balance',
      'Wallet running low',
      'Your wallet balance is ₹' || (v_balance - v_total)::text || '. Recharge to keep ordering.',
      '/app/wallet', '{}'::jsonb, array['in_app','whatsapp'], 6
    );
  end if;

  return v_order_id;
end $$;

create or replace function public.cancel_order_with_refund(p_order_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_balance numeric;
  v_is_admin boolean := public.is_admin(v_uid);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.user_id <> v_uid and not v_is_admin then raise exception 'forbidden'; end if;
  if v_order.status in ('cancelled', 'delivered') then return; end if;
  if not v_is_admin and now() > public.cutoff_for(v_order.meal_type, v_order.delivery_date) then
    raise exception 'cutoff_passed_no_self_cancel';
  end if;

  update public.orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  insert into public.order_events(order_id, status, actor_id, note)
  values (p_order_id, 'cancelled', v_uid, coalesce(p_reason, 'Cancelled'));

  select balance into v_balance from public.wallets where user_id = v_order.user_id for update;
  if v_balance is null then
    insert into public.wallets(user_id, balance) values (v_order.user_id, 0);
    v_balance := 0;
  end if;
  update public.wallets set balance = balance + v_order.total, updated_at = now()
    where user_id = v_order.user_id;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  values (v_order.user_id, 'refund', v_order.total, v_balance + v_order.total,
          'Refund for cancelled order', p_order_id);

  perform public.notify_user(
    v_order.user_id, 'order_cancelled',
    'Order cancelled',
    'Your order was cancelled. ₹' || v_order.total::text || ' refunded to your wallet.',
    '/app/wallet',
    jsonb_build_object('order_id', p_order_id, 'reason', p_reason, 'refund', v_order.total),
    array['in_app','whatsapp'], 3
  );
end $$;do $$
declare v_url text := 'https://project--e8a84f19-ab30-4d76-8250-92984cd0d181.lovable.app/api/public/hooks/dispatch-notifications';
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dispatch-notifications-every-min';
    perform cron.schedule(
      'dispatch-notifications-every-min',
      '* * * * *',
      format($cron$ select net.http_post(url:=%L, headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb); $cron$, v_url)
    );
  end if;
end $$;-- =========================================================
-- GROWTH: referrals, loyalty, ratings, retention
-- =========================================================

-- ---------- REFERRALS ----------
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
create policy "ref code self read" on public.referral_codes
  for select using (auth.uid() = user_id or is_admin(auth.uid()));
create policy "ref code self insert" on public.referral_codes
  for insert with check (auth.uid() = user_id);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referee_id uuid not null references auth.users(id) on delete cascade unique,
  code text not null,
  status text not null default 'pending', -- pending | rewarded | rejected
  reward_amount numeric(12,2),
  rewarded_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.referrals enable row level security;
create policy "ref self read" on public.referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referee_id or is_admin(auth.uid()));
create policy "ref admin manage" on public.referrals
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create index if not exists idx_referrals_referrer on public.referrals(referrer_id);
create index if not exists idx_referrals_status on public.referrals(status);

-- ---------- LOYALTY ----------
create table if not exists public.loyalty_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points integer not null default 0,
  lifetime_points integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.loyalty_accounts enable row level security;
create policy "loyalty self read" on public.loyalty_accounts
  for select using (auth.uid() = user_id or is_admin(auth.uid()));

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,           -- +earn, -redeem
  reason text not null,             -- order_earn | redeem_wallet | referral_bonus | adjust
  reference_id uuid,
  balance_after integer not null,
  created_at timestamptz not null default now()
);
alter table public.loyalty_ledger enable row level security;
create policy "loyalty ledger self read" on public.loyalty_ledger
  for select using (auth.uid() = user_id or is_admin(auth.uid()));

create index if not exists idx_loyalty_ledger_user on public.loyalty_ledger(user_id, created_at desc);

-- ---------- RATINGS ----------
create table if not exists public.order_ratings (
  order_id uuid primary key references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rider_id uuid references public.riders(id) on delete set null,
  food_rating smallint not null check (food_rating between 1 and 5),
  rider_rating smallint check (rider_rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
alter table public.order_ratings enable row level security;
create policy "rating self read" on public.order_ratings
  for select using (auth.uid() = user_id or is_admin(auth.uid()));
create policy "rating self insert" on public.order_ratings
  for insert with check (auth.uid() = user_id);
create index if not exists idx_ratings_rider on public.order_ratings(rider_id);

-- =========================================================
-- HELPERS
-- =========================================================

create or replace function public.gen_referral_code(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := upper(substr(replace(p_user_id::text,'-',''), 1, 6));
  return 'TIF' || v;
end $$;

create or replace function public.my_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select code into v from public.referral_codes where user_id = auth.uid();
  if v is null then
    v := public.gen_referral_code(auth.uid());
    insert into public.referral_codes(user_id, code) values (auth.uid(), v)
      on conflict (user_id) do nothing;
    select code into v from public.referral_codes where user_id = auth.uid();
  end if;
  return v;
end $$;

-- =========================================================
-- REFERRAL APPLY (called once by referee, before/after first order)
-- =========================================================
create or replace function public.apply_referral_code(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_referrer uuid; v_existing uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_code is null or length(trim(p_code)) < 4 then raise exception 'invalid_code'; end if;

  select user_id into v_referrer from public.referral_codes where code = upper(trim(p_code));
  if v_referrer is null then raise exception 'code_not_found'; end if;
  if v_referrer = v_uid then raise exception 'self_referral'; end if;

  select id into v_existing from public.referrals where referee_id = v_uid;
  if v_existing is not null then raise exception 'already_referred'; end if;

  insert into public.referrals(referrer_id, referee_id, code, status)
  values (v_referrer, v_uid, upper(trim(p_code)), 'pending');
end $$;

-- =========================================================
-- REWARD ON FIRST DELIVERED ORDER
-- (Called by retention cron + admin / manual triggers)
-- Pays referrer + referee a configurable wallet credit
-- =========================================================
create or replace function public.reward_pending_referrals()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; v_count int := 0;
  v_amount numeric := 50;     -- default ₹50 each
  v_min_order numeric := 100; -- referee must have ≥1 delivered order ≥ ₹100
  v_settings jsonb;
  v_balance numeric;
begin
  select value into v_settings from public.app_settings where key = 'growth';
  if v_settings is not null then
    v_amount := coalesce((v_settings->>'referral_reward')::numeric, v_amount);
    v_min_order := coalesce((v_settings->>'referral_min_order')::numeric, v_min_order);
  end if;

  for r in
    select rf.id, rf.referrer_id, rf.referee_id
    from public.referrals rf
    where rf.status = 'pending'
      and exists (
        select 1 from public.orders o
        where o.user_id = rf.referee_id
          and o.status = 'delivered'
          and o.total >= v_min_order
      )
  loop
    -- credit referrer
    insert into public.wallets(user_id, balance) values (r.referrer_id, 0)
      on conflict (user_id) do nothing;
    update public.wallets set balance = balance + v_amount, updated_at = now()
      where user_id = r.referrer_id returning balance into v_balance;
    insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
      values (r.referrer_id, 'recharge', v_amount, v_balance, 'Referral reward', r.id);

    -- credit referee
    insert into public.wallets(user_id, balance) values (r.referee_id, 0)
      on conflict (user_id) do nothing;
    update public.wallets set balance = balance + v_amount, updated_at = now()
      where user_id = r.referee_id returning balance into v_balance;
    insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
      values (r.referee_id, 'recharge', v_amount, v_balance, 'Referral welcome bonus', r.id);

    update public.referrals set status='rewarded', reward_amount=v_amount, rewarded_at=now()
      where id = r.id;

    perform public.notify_user(r.referrer_id, 'referral_rewarded',
      'Referral reward credited',
      '₹' || v_amount::text || ' added to your wallet.', '/app/wallet',
      jsonb_build_object('amount', v_amount), array['in_app','whatsapp'], 4);
    perform public.notify_user(r.referee_id, 'referral_welcome',
      'Welcome bonus credited',
      '₹' || v_amount::text || ' added to your wallet for joining via referral.',
      '/app/wallet', jsonb_build_object('amount', v_amount),
      array['in_app','whatsapp'], 4);

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- =========================================================
-- LOYALTY ACCRUAL (on delivered orders, idempotent per order)
-- =========================================================
create or replace function public.accrue_loyalty_for_delivered()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_pts int; v_bal int; v_count int := 0;
  v_settings jsonb; v_rate numeric := 1.0; -- pts per ₹1
begin
  select value into v_settings from public.app_settings where key = 'growth';
  if v_settings is not null then
    v_rate := coalesce((v_settings->>'loyalty_rate')::numeric, v_rate);
  end if;

  for r in
    select o.id, o.user_id, o.total
    from public.orders o
    where o.status = 'delivered'
      and not exists (select 1 from public.loyalty_ledger l where l.reference_id = o.id and l.reason = 'order_earn')
    limit 500
  loop
    v_pts := floor(r.total * v_rate)::int;
    if v_pts <= 0 then continue; end if;

    insert into public.loyalty_accounts(user_id, points, lifetime_points)
      values (r.user_id, v_pts, v_pts)
      on conflict (user_id) do update
      set points = loyalty_accounts.points + excluded.points,
          lifetime_points = loyalty_accounts.lifetime_points + excluded.points,
          updated_at = now()
      returning points into v_bal;

    insert into public.loyalty_ledger(user_id, delta, reason, reference_id, balance_after)
      values (r.user_id, v_pts, 'order_earn', r.id, v_bal);

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Customer redeems points → wallet credit
create or replace function public.redeem_loyalty_points(p_points int)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_acc public.loyalty_accounts%rowtype;
  v_amount numeric; v_bal numeric; v_pbal int;
  v_settings jsonb; v_per100 numeric := 10; -- ₹10 per 100 pts
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_points is null or p_points < 100 or p_points % 100 <> 0 then raise exception 'min_100_multiples'; end if;

  select value into v_settings from public.app_settings where key = 'growth';
  if v_settings is not null then
    v_per100 := coalesce((v_settings->>'loyalty_redeem_per_100')::numeric, v_per100);
  end if;

  select * into v_acc from public.loyalty_accounts where user_id = v_uid for update;
  if v_acc.points is null or v_acc.points < p_points then raise exception 'insufficient_points'; end if;

  v_amount := (p_points / 100.0) * v_per100;

  update public.loyalty_accounts set points = points - p_points, updated_at = now()
    where user_id = v_uid returning points into v_pbal;
  insert into public.loyalty_ledger(user_id, delta, reason, balance_after)
    values (v_uid, -p_points, 'redeem_wallet', v_pbal);

  insert into public.wallets(user_id, balance) values (v_uid, 0)
    on conflict (user_id) do nothing;
  update public.wallets set balance = balance + v_amount, updated_at = now()
    where user_id = v_uid returning balance into v_bal;
  insert into public.wallet_transactions(user_id, type, amount, balance_after, description)
    values (v_uid, 'recharge', v_amount, v_bal, 'Loyalty redemption');

  perform public.notify_user(v_uid, 'loyalty_redeemed',
    'Loyalty redeemed',
    '₹' || v_amount::text || ' added to your wallet from ' || p_points::text || ' points.',
    '/app/wallet', jsonb_build_object('points', p_points, 'amount', v_amount),
    array['in_app'], 5);

  return v_amount;
end $$;

-- =========================================================
-- RATINGS
-- =========================================================
create or replace function public.submit_order_rating(
  p_order_id uuid, p_food smallint, p_rider smallint default null, p_comment text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rider uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.orders where id = p_order_id and user_id = v_uid and status = 'delivered') then
    raise exception 'order_not_eligible';
  end if;
  select rider_id into v_rider from public.orders where id = p_order_id;
  insert into public.order_ratings(order_id, user_id, rider_id, food_rating, rider_rating, comment)
  values (p_order_id, v_uid, v_rider, p_food, p_rider, p_comment)
  on conflict (order_id) do update
    set food_rating = excluded.food_rating,
        rider_rating = excluded.rider_rating,
        comment = excluded.comment;
end $$;

-- =========================================================
-- RETENTION
-- =========================================================
create or replace function public.retention_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inactive int := 0; v_low_wallet int := 0;
  r record; v_settings jsonb;
  v_inactive_days int := 14; v_low_threshold numeric := 100;
begin
  select value into v_settings from public.app_settings where key = 'growth';
  if v_settings is not null then
    v_inactive_days := coalesce((v_settings->>'inactive_days')::int, v_inactive_days);
    v_low_threshold := coalesce((v_settings->>'low_wallet_threshold')::numeric, v_low_threshold);
  end if;

  -- Inactive users (no order in N days, but have ordered before)
  for r in
    select p.id as user_id
    from public.profiles p
    where exists (select 1 from public.orders o where o.user_id = p.id)
      and not exists (
        select 1 from public.orders o
        where o.user_id = p.id and o.created_at >= now() - make_interval(days => v_inactive_days)
      )
      and not exists (
        select 1 from public.notifications n
        where n.user_id = p.id and n.type = 'win_back'
          and n.created_at >= now() - interval '7 days'
      )
    limit 500
  loop
    perform public.notify_user(r.user_id, 'win_back',
      'We miss you 🍱',
      'Order your favourite tiffin today — fresh, hot and delivered on time.',
      '/app/menu', '{}'::jsonb, array['in_app','whatsapp'], 6);
    v_inactive := v_inactive + 1;
  end loop;

  -- Low wallet active users
  for r in
    select w.user_id
    from public.wallets w
    where w.balance < v_low_threshold
      and exists (select 1 from public.orders o where o.user_id = w.user_id and o.created_at >= now() - interval '30 days')
      and not exists (
        select 1 from public.notifications n
        where n.user_id = w.user_id and n.type = 'recharge_nudge'
          and n.created_at >= now() - interval '3 days'
      )
    limit 500
  loop
    perform public.notify_user(r.user_id, 'recharge_nudge',
      'Top up your wallet',
      'Recharge now to keep ordering without interruption.',
      '/app/wallet', '{}'::jsonb, array['in_app'], 7);
    v_low_wallet := v_low_wallet + 1;
  end loop;

  return jsonb_build_object('inactive_notified', v_inactive, 'low_wallet_notified', v_low_wallet);
end $$;

-- =========================================================
-- ADMIN GROWTH KPIs
-- =========================================================
create or replace function public.admin_growth_kpis()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'referrals_total',     (select count(*) from referrals),
    'referrals_rewarded',  (select count(*) from referrals where status = 'rewarded'),
    'referral_payout_30d', coalesce((select sum(reward_amount) from referrals where rewarded_at >= now() - interval '30 days'), 0),
    'loyalty_outstanding', coalesce((select sum(points) from loyalty_accounts), 0),
    'loyalty_lifetime',    coalesce((select sum(lifetime_points) from loyalty_accounts), 0),
    'rating_avg_food_30d', coalesce((select round(avg(food_rating)::numeric, 2) from order_ratings where created_at >= now() - interval '30 days'), 0),
    'rating_avg_rider_30d',coalesce((select round(avg(rider_rating)::numeric, 2) from order_ratings where created_at >= now() - interval '30 days' and rider_rating is not null), 0),
    'ratings_count_30d',   (select count(*) from order_ratings where created_at >= now() - interval '30 days'),
    'active_30d',          (select count(distinct user_id) from orders where created_at >= now() - interval '30 days'),
    'inactive_14d',        (
      select count(*) from profiles p
      where exists (select 1 from orders o where o.user_id = p.id)
        and not exists (select 1 from orders o where o.user_id = p.id and o.created_at >= now() - interval '14 days')
    )
  ) into v;
  return v;
end $$;
-- Kitchen batches
create table if not exists public.kitchen_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  meal_type meal_type not null,
  round_label text not null default 'R1',
  status text not null default 'planned', -- planned | packing | ready | dispatched | delivered
  planned_mini int not null default 0,
  planned_large int not null default 0,
  planned_breakfast int not null default 0,
  rider_id uuid,
  dispatched_at timestamptz,
  created_by uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kitchen_batches enable row level security;

drop policy if exists "kitchen batches admin manage" on public.kitchen_batches;
create policy "kitchen batches admin manage" on public.kitchen_batches
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "kitchen batches rider read" on public.kitchen_batches;
create policy "kitchen batches rider read" on public.kitchen_batches
  for select using (
    public.is_admin(auth.uid())
    or exists (select 1 from public.riders r where r.id = kitchen_batches.rider_id and r.user_id = auth.uid())
  );

create index if not exists idx_kitchen_batches_date_meal on public.kitchen_batches(delivery_date, meal_type);

drop trigger if exists trg_kbatches_touch on public.kitchen_batches;
create trigger trg_kbatches_touch before update on public.kitchen_batches
  for each row execute function public.touch_updated_at();

-- order kitchen columns
alter table public.orders add column if not exists prep_status text not null default 'pending';
alter table public.orders add column if not exists packed_at timestamptz;
alter table public.orders add column if not exists batch_id uuid;
create index if not exists idx_orders_batch on public.orders(batch_id);
create index if not exists idx_orders_prep on public.orders(delivery_date, meal_type, prep_status);

-- KPIs / plan
create or replace function public.kitchen_plan(p_date date default null, p_meal meal_type default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v jsonb;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  with base as (
    select o.id, o.meal_type, o.status, o.prep_status, o.batch_id,
           coalesce(sum(case when oi.size = 'mini'  then oi.qty else 0 end), 0) as mini,
           coalesce(sum(case when oi.size = 'large' then oi.qty else 0 end), 0) as large,
           coalesce(sum(case when oi.size = 'fixed' then oi.qty else 0 end), 0) as fixed
    from orders o
    left join order_items oi on oi.order_id = o.id
    where o.delivery_date = v_date
      and (p_meal is null or o.meal_type = p_meal)
      and o.status not in ('cancelled')
    group by o.id, o.meal_type, o.status, o.prep_status, o.batch_id
  )
  select jsonb_build_object(
    'date', v_date,
    'orders_total', (select count(*) from base),
    'mini_total',   coalesce((select sum(mini) from base), 0),
    'large_total',  coalesce((select sum(large) from base), 0),
    'breakfast_total', coalesce((select sum(fixed) from base where meal_type = 'breakfast'), 0),
    'pending_prep', (select count(*) from base where prep_status = 'pending'),
    'prepping',    (select count(*) from base where prep_status = 'prepping'),
    'packed',      (select count(*) from base where prep_status = 'packed'),
    'ready',       (select count(*) from base where prep_status = 'ready'),
    'unbatched',   (select count(*) from base where batch_id is null),
    'by_meal', (
      select jsonb_object_agg(meal_type, jsonb_build_object(
        'orders', cnt, 'mini', mini, 'large', large, 'fixed', fixed
      )) from (
        select meal_type, count(*) as cnt, sum(mini) as mini, sum(large) as large, sum(fixed) as fixed
        from base group by meal_type
      ) t
    )
  ) into v;
  return v;
end $$;

-- Today orders (kitchen view)
create or replace function public.kitchen_today_orders(p_date date default null, p_meal meal_type default null)
returns table(
  order_id uuid, user_id uuid, full_name text, phone text, address text,
  meal_type meal_type, delivery_window delivery_window, status order_status,
  prep_status text, batch_id uuid, total numeric,
  mini int, large int, fixed int, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select o.id, o.user_id, p.full_name, p.phone, o.address,
         o.meal_type, o.delivery_window, o.status,
         o.prep_status, o.batch_id, o.total,
         coalesce(sum(case when oi.size='mini' then oi.qty end),0)::int,
         coalesce(sum(case when oi.size='large' then oi.qty end),0)::int,
         coalesce(sum(case when oi.size='fixed' then oi.qty end),0)::int,
         o.created_at
  from orders o
  left join profiles p on p.id = o.user_id
  left join order_items oi on oi.order_id = o.id
  where o.delivery_date = coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date)
    and (p_meal is null or o.meal_type = p_meal)
    and o.status <> 'cancelled'
    and is_admin(auth.uid())
  group by o.id, p.full_name, p.phone
  order by o.created_at;
$$;

-- Create batch and assign unbatched orders
create or replace function public.kitchen_create_batch(
  p_date date, p_meal meal_type, p_round text default 'R1', p_window delivery_window default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_mini int; v_large int; v_fixed int;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  insert into public.kitchen_batches(delivery_date, meal_type, round_label, created_by)
    values (p_date, p_meal, coalesce(p_round,'R1'), auth.uid())
    returning id into v_id;

  update public.orders o
    set batch_id = v_id, updated_at = now()
    where o.delivery_date = p_date
      and o.meal_type = p_meal
      and o.batch_id is null
      and o.status not in ('cancelled','delivered')
      and (p_window is null or o.delivery_window = p_window);

  select coalesce(sum(case when oi.size='mini' then oi.qty end),0),
         coalesce(sum(case when oi.size='large' then oi.qty end),0),
         coalesce(sum(case when oi.size='fixed' then oi.qty end),0)
    into v_mini, v_large, v_fixed
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.batch_id = v_id;

  update public.kitchen_batches
    set planned_mini = v_mini, planned_large = v_large, planned_breakfast = v_fixed
    where id = v_id;
  return v_id;
end $$;

-- Update order prep status
create or replace function public.kitchen_set_order_prep(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_status not in ('pending','prepping','packed','ready') then raise exception 'invalid_status'; end if;
  update public.orders
    set prep_status = p_status,
        packed_at = case when p_status in ('packed','ready') and packed_at is null then now() else packed_at end,
        status = case when p_status in ('packed','ready') and status = 'placed' then 'preparing' else status end,
        updated_at = now()
  where id = p_order_id;

  insert into public.order_events(order_id, status, actor_id, note)
    values (p_order_id,
            (select status from public.orders where id = p_order_id),
            auth.uid(),
            'Kitchen: ' || p_status);
end $$;

-- Mark whole batch packed/ready
create or replace function public.kitchen_set_batch_status(p_batch_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_status not in ('planned','packing','ready','dispatched') then raise exception 'invalid_status'; end if;
  update public.kitchen_batches set status = p_status, updated_at = now() where id = p_batch_id;
  if p_status = 'ready' then
    update public.orders set prep_status='ready', updated_at = now()
      where batch_id = p_batch_id and prep_status <> 'ready';
  end if;
end $$;

-- Dispatch batch to rider: creates deliveries, sets out_for_delivery
create or replace function public.kitchen_dispatch_batch(p_batch_id uuid, p_rider_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_count int := 0;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  update public.kitchen_batches
    set rider_id = p_rider_id, status = 'dispatched', dispatched_at = now()
    where id = p_batch_id;

  for r in select id from public.orders where batch_id = p_batch_id and status not in ('delivered','cancelled') loop
    perform public.assign_delivery(r.id, p_rider_id);
    update public.orders set status = 'out_for_delivery', updated_at = now() where id = r.id;
    insert into public.order_events(order_id, status, actor_id, note)
      values (r.id, 'out_for_delivery', auth.uid(), 'Dispatched in batch');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Emergency meal toggle
create or replace function public.kitchen_meal_toggle(p_date date, p_meal meal_type, p_open boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  insert into public.daily_menu_overrides(date, meal_type, is_open, note)
    values (p_date, p_meal, p_open, p_note);
end $$;

-- enums
do $$ begin
  create type public.ticket_status as enum ('open','in_progress','waiting_customer','resolved','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority as enum ('low','normal','high','urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_category as enum (
    'delivery_delayed','delivery_wrong','delivery_failed',
    'payment_failed','wallet_not_updated','recharge_issue',
    'refund_request','otp_issue','rider_issue','order_issue','other'
  );
exception when duplicate_object then null; end $$;

-- tickets
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  order_id uuid,
  subject text not null,
  category ticket_category not null default 'other',
  priority ticket_priority not null default 'normal',
  status ticket_status not null default 'open',
  refund_amount numeric(12,2),
  resolution_note text,
  assigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_message_at timestamptz not null default now()
);
create index if not exists idx_tickets_user on public.support_tickets(user_id, created_at desc);
create index if not exists idx_tickets_status on public.support_tickets(status, priority desc, last_message_at desc);

-- messages
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null,
  is_admin boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_msgs_ticket on public.support_messages(ticket_id, created_at);

-- RLS
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "tickets self read" on public.support_tickets;
create policy "tickets self read" on public.support_tickets for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "tickets self insert" on public.support_tickets;
create policy "tickets self insert" on public.support_tickets for insert
  with check (auth.uid() = user_id);

drop policy if exists "tickets admin update" on public.support_tickets;
create policy "tickets admin update" on public.support_tickets for update
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "msgs ticket read" on public.support_messages;
create policy "msgs ticket read" on public.support_messages for select
  using (exists (select 1 from public.support_tickets t
    where t.id = ticket_id and (t.user_id = auth.uid() or public.is_admin(auth.uid()))));

drop policy if exists "msgs ticket insert" on public.support_messages;
create policy "msgs ticket insert" on public.support_messages for insert
  with check (
    author_id = auth.uid() and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.user_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

-- functions
create or replace function public.create_support_ticket(
  p_subject text, p_category ticket_category, p_message text,
  p_order_id uuid default null, p_priority ticket_priority default 'normal'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(length(trim(p_subject)),0) < 3 then raise exception 'invalid_subject'; end if;
  if coalesce(length(trim(p_message)),0) < 3 then raise exception 'invalid_message'; end if;

  insert into public.support_tickets(user_id, order_id, subject, category, priority)
  values (v_uid, p_order_id, trim(p_subject), p_category, p_priority)
  returning id into v_id;

  insert into public.support_messages(ticket_id, author_id, is_admin, body)
  values (v_id, v_uid, false, trim(p_message));

  perform public.notify_user(v_uid, 'support_ticket_created',
    'Support ticket received',
    'We''ve received your request. Our team will respond shortly.',
    '/app/support/' || v_id::text,
    jsonb_build_object('ticket_id', v_id, 'subject', p_subject),
    array['in_app','whatsapp'], 4);
  return v_id;
end $$;

create or replace function public.add_support_message(p_ticket_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_owner uuid; v_id uuid; v_status ticket_status;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(length(trim(p_body)),0) < 1 then raise exception 'empty_message'; end if;
  v_admin := public.is_admin(v_uid);
  select user_id, status into v_owner, v_status from public.support_tickets where id = p_ticket_id for update;
  if v_owner is null then raise exception 'ticket_not_found'; end if;
  if not v_admin and v_owner <> v_uid then raise exception 'forbidden'; end if;

  insert into public.support_messages(ticket_id, author_id, is_admin, body)
  values (p_ticket_id, v_uid, v_admin, trim(p_body)) returning id into v_id;

  update public.support_tickets
    set last_message_at = now(),
        updated_at = now(),
        status = case
          when v_admin and v_status in ('open') then 'in_progress'::ticket_status
          when not v_admin and v_status = 'waiting_customer' then 'in_progress'::ticket_status
          else v_status end
  where id = p_ticket_id;

  if v_admin then
    perform public.notify_user(v_owner, 'support_reply',
      'Support replied',
      left(trim(p_body), 140),
      '/app/support/' || p_ticket_id::text,
      jsonb_build_object('ticket_id', p_ticket_id),
      array['in_app','whatsapp'], 4);
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_ticket_status(p_ticket_id uuid, p_status ticket_status, p_priority ticket_priority default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select user_id into v_owner from public.support_tickets where id = p_ticket_id;
  if v_owner is null then raise exception 'ticket_not_found'; end if;

  update public.support_tickets
    set status = p_status,
        priority = coalesce(p_priority, priority),
        resolved_at = case when p_status in ('resolved','closed') then now() else resolved_at end,
        updated_at = now()
  where id = p_ticket_id;

  perform public.notify_user(v_owner, 'support_status',
    'Ticket ' || replace(p_status::text,'_',' '),
    'Your support ticket status has been updated.',
    '/app/support/' || p_ticket_id::text,
    jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status),
    array['in_app'], 5);
end $$;

create or replace function public.admin_resolve_ticket_with_refund(
  p_ticket_id uuid, p_resolution text, p_refund numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal numeric;
begin
  if not public.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_refund is null or p_refund < 0 then raise exception 'invalid_refund'; end if;

  select user_id into v_owner from public.support_tickets where id = p_ticket_id for update;
  if v_owner is null then raise exception 'ticket_not_found'; end if;

  if p_refund > 0 then
    insert into public.wallets(user_id, balance) values (v_owner, 0) on conflict (user_id) do nothing;
    update public.wallets set balance = balance + p_refund, updated_at = now()
      where user_id = v_owner returning balance into v_bal;
    insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
      values (v_owner, 'refund', p_refund, v_bal, 'Support refund', p_ticket_id);
  end if;

  update public.support_tickets
    set status = 'resolved',
        resolution_note = p_resolution,
        refund_amount = case when p_refund > 0 then p_refund else refund_amount end,
        resolved_at = now(),
        updated_at = now()
  where id = p_ticket_id;

  insert into public.support_messages(ticket_id, author_id, is_admin, body)
  values (p_ticket_id, auth.uid(), true,
    coalesce(p_resolution, 'Resolved') ||
    case when p_refund > 0 then E'\n\nRefunded ₹' || p_refund::text || ' to your wallet.' else '' end);

  perform public.notify_user(v_owner, 'support_resolved',
    'Ticket resolved',
    coalesce(p_resolution, 'Your support ticket has been resolved.') ||
    case when p_refund > 0 then ' Refund of ₹' || p_refund::text || ' credited.' else '' end,
    '/app/support/' || p_ticket_id::text,
    jsonb_build_object('ticket_id', p_ticket_id, 'refund', p_refund),
    array['in_app','whatsapp'], 3);
end $$;

create or replace function public.admin_support_kpis()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'open',              (select count(*) from support_tickets where status = 'open'),
    'in_progress',       (select count(*) from support_tickets where status = 'in_progress'),
    'waiting_customer',  (select count(*) from support_tickets where status = 'waiting_customer'),
    'urgent_open',       (select count(*) from support_tickets where status not in ('resolved','closed') and priority in ('high','urgent')),
    'resolved_7d',       (select count(*) from support_tickets where resolved_at >= now() - interval '7 days'),
    'avg_resolution_hours', coalesce((select round(avg(extract(epoch from (resolved_at - created_at))/3600.0)::numeric, 1)
                              from support_tickets where resolved_at >= now() - interval '30 days'), 0),
    'refunds_7d_amount', coalesce((select sum(refund_amount) from support_tickets
                              where resolved_at >= now() - interval '7 days' and refund_amount > 0), 0),
    'refunds_7d_count',  (select count(*) from support_tickets
                              where resolved_at >= now() - interval '7 days' and refund_amount > 0)
  ) into v;
  return v;
end $$;

-- realtime
alter publication supabase_realtime add table public.support_tickets;
alter publication supabase_realtime add table public.support_messages;

-- Merchant UPI VPA (overridable from super admin settings)
insert into public.app_settings(key, value)
values ('payments', jsonb_build_object('upi_vpa', 'tiffin@upi', 'merchant_name', 'Tiffin Kitchen'))
on conflict (key) do nothing;

-- Index for admin verification queue
create index if not exists payments_status_created_idx on public.payments (status, created_at desc);

-- 1) Customer creates a payment request -> returns id + QR payload
create or replace function public.create_payment_request(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_settings jsonb;
  v_vpa text;
  v_name text;
  v_qr text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount < 10 then raise exception 'min_amount_10'; end if;
  if p_amount > 50000 then raise exception 'max_amount_50000'; end if;

  select value into v_settings from public.app_settings where key = 'payments';
  v_vpa  := coalesce(v_settings->>'upi_vpa', 'tiffin@upi');
  v_name := coalesce(v_settings->>'merchant_name', 'Tiffin Kitchen');

  -- UPI deep-link payload (works in any UPI app; QR encodes this string)
  v_qr := 'upi://pay?pa=' || v_vpa
        || '&pn=' || replace(v_name, ' ', '%20')
        || '&am=' || p_amount::text
        || '&cu=INR'
        || '&tn=Tiffin%20wallet%20topup';

  insert into public.payments(user_id, amount, method, status, qr_payload)
  values (v_uid, p_amount, 'upi'::payment_method, 'pending'::payment_status, v_qr)
  returning id into v_id;

  return jsonb_build_object(
    'payment_id', v_id,
    'amount', p_amount,
    'qr_payload', v_qr,
    'vpa', v_vpa,
    'merchant_name', v_name
  );
end $$;

-- 2) Customer submits the UTR / reference after paying
create or replace function public.submit_payment_utr(p_payment_id uuid, p_utr text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_status payment_status;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(length(trim(p_utr)), 0) < 4 then raise exception 'invalid_utr'; end if;

  select user_id, status into v_owner, v_status
    from public.payments where id = p_payment_id for update;
  if v_owner is null then raise exception 'payment_not_found'; end if;
  if v_owner <> v_uid then raise exception 'forbidden'; end if;
  if v_status <> 'pending' then raise exception 'payment_not_pending'; end if;

  update public.payments
    set utr_reference = trim(p_utr), updated_at = now()
    where id = p_payment_id;

  -- Notify admins via in_app to the user; admin queue is realtime-driven
  perform public.notify_user(
    v_uid, 'payment_submitted',
    'Payment submitted',
    'We received your UTR. Verification usually takes a few minutes.',
    '/app/wallet',
    jsonb_build_object('payment_id', p_payment_id, 'utr', p_utr),
    array['in_app'], 5
  );
end $$;

-- 3) Admin verifies -> atomic wallet credit + ledger + notify
create or replace function public.admin_verify_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid; v_amount numeric; v_status payment_status; v_balance numeric;
begin
  if not is_admin(v_uid) then raise exception 'forbidden'; end if;

  select user_id, amount, status into v_owner, v_amount, v_status
    from public.payments where id = p_payment_id for update;
  if v_owner is null then raise exception 'payment_not_found'; end if;
  if v_status = 'verified' then return; end if;
  if v_status not in ('pending') then raise exception 'invalid_status'; end if;

  insert into public.wallets(user_id, balance) values (v_owner, 0) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + v_amount, updated_at = now()
    where user_id = v_owner returning balance into v_balance;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  values (v_owner, 'recharge', v_amount, v_balance, 'Wallet recharge (UPI)', p_payment_id);

  update public.payments
    set status = 'verified'::payment_status,
        verified_at = now(),
        verified_by = v_uid,
        updated_at = now()
    where id = p_payment_id;

  insert into public.audit_log(actor_id, action, target, meta)
  values (v_uid, 'payment.verify', p_payment_id::text,
          jsonb_build_object('user_id', v_owner, 'amount', v_amount));

  perform public.notify_user(
    v_owner, 'wallet_credited',
    'Wallet credited',
    '₹' || v_amount::text || ' added to your wallet.',
    '/app/wallet',
    jsonb_build_object('payment_id', p_payment_id, 'amount', v_amount, 'balance', v_balance),
    array['in_app','whatsapp'], 4
  );
end $$;

-- 4) Admin rejects payment
create or replace function public.admin_reject_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid; v_status payment_status;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select user_id, status into v_owner, v_status
    from public.payments where id = p_payment_id for update;
  if v_owner is null then raise exception 'payment_not_found'; end if;
  if v_status <> 'pending' then raise exception 'invalid_status'; end if;

  update public.payments
    set status = 'failed'::payment_status, updated_at = now()
    where id = p_payment_id;

  insert into public.audit_log(actor_id, action, target, meta)
  values (auth.uid(), 'payment.reject', p_payment_id::text,
          jsonb_build_object('user_id', v_owner, 'reason', p_reason));

  perform public.notify_user(
    v_owner, 'payment_rejected',
    'Payment could not be verified',
    coalesce(p_reason, 'Please try again or contact support.'),
    '/app/wallet',
    jsonb_build_object('payment_id', p_payment_id, 'reason', p_reason),
    array['in_app','whatsapp'], 3
  );
end $$;

-- 5) Admin manual wallet adjustment (rare; full audit trail)
create or replace function public.admin_adjust_wallet(p_user_id uuid, p_delta numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_balance numeric;
begin
  if not is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'invalid_delta'; end if;
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'reason_required'; end if;

  insert into public.wallets(user_id, balance) values (p_user_id, 0) on conflict (user_id) do nothing;

  -- Lock and validate non-negative balance
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if (v_balance + p_delta) < 0 then raise exception 'insufficient_balance'; end if;

  update public.wallets set balance = balance + p_delta, updated_at = now()
    where user_id = p_user_id returning balance into v_balance;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description)
  values (p_user_id,
          case when p_delta > 0 then 'recharge' else 'adjustment' end,
          p_delta, v_balance, 'Admin adjustment: ' || p_reason);

  insert into public.audit_log(actor_id, action, target, meta)
  values (auth.uid(), 'wallet.adjust', p_user_id::text,
          jsonb_build_object('delta', p_delta, 'reason', p_reason, 'balance', v_balance));

  perform public.notify_user(
    p_user_id,
    case when p_delta > 0 then 'wallet_credited' else 'wallet_debited' end,
    case when p_delta > 0 then 'Wallet credited' else 'Wallet adjusted' end,
    '₹' || abs(p_delta)::text || ' ' || (case when p_delta > 0 then 'added to' else 'deducted from' end)
      || ' your wallet. Reason: ' || p_reason,
    '/app/wallet',
    jsonb_build_object('delta', p_delta, 'balance', v_balance),
    array['in_app'], 4
  );

  return v_balance;
end $$;

-- Realtime
alter publication supabase_realtime add table public.wallets;
alter publication supabase_realtime add table public.wallet_transactions;
alter publication supabase_realtime add table public.payments;
create or replace function public.admin_verify_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid; v_amount numeric; v_status payment_status; v_balance numeric;
begin
  if not is_admin(v_uid) then raise exception 'forbidden'; end if;

  select user_id, amount, status into v_owner, v_amount, v_status
    from public.payments where id = p_payment_id for update;
  if v_owner is null then raise exception 'payment_not_found'; end if;
  if v_status = 'success' then return; end if;
  if v_status not in ('pending') then raise exception 'invalid_status'; end if;

  insert into public.wallets(user_id, balance) values (v_owner, 0) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + v_amount, updated_at = now()
    where user_id = v_owner returning balance into v_balance;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  values (v_owner, 'recharge', v_amount, v_balance, 'Wallet recharge (UPI)', p_payment_id);

  update public.payments
    set status = 'success'::payment_status,
        verified_at = now(),
        verified_by = v_uid,
        updated_at = now()
    where id = p_payment_id;

  insert into public.audit_log(actor_id, action, target, meta)
  values (v_uid, 'payment.verify', p_payment_id::text,
          jsonb_build_object('user_id', v_owner, 'amount', v_amount));

  perform public.notify_user(
    v_owner, 'wallet_credited',
    'Wallet credited',
    '₹' || v_amount::text || ' added to your wallet.',
    '/app/wallet',
    jsonb_build_object('payment_id', p_payment_id, 'amount', v_amount, 'balance', v_balance),
    array['in_app','whatsapp'], 4
  );
end $$;ALTER TABLE public.riders REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'riders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.riders';
  END IF;
END $$;