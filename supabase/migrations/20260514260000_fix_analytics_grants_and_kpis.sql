-- Four analytics fixes:
-- 1. admin_kpis: 'recharge' is wrong enum value → fix to 'topup'
-- 2. admin_growth_kpis: missing GRANT EXECUTE → growth section always errors
-- 3. admin_support_kpis: missing GRANT EXECUTE → support section always errors
-- 4. orders table not in realtime publication → analytics RT hook and order tracking never fire

-- ── 1. Fix admin_kpis (recharges_today used wrong enum value 'recharge') ────────
CREATE OR REPLACE FUNCTION public.admin_kpis()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
DECLARE
  v    jsonb;
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'orders_today',     (SELECT count(*) FROM orders WHERE delivery_date = today),
    'revenue_today',    coalesce((SELECT sum(total) FROM orders WHERE delivery_date = today AND status <> 'cancelled'), 0),
    'pending',          (SELECT count(*) FROM orders WHERE delivery_date = today AND status IN ('placed','preparing')),
    'out_for_delivery', (SELECT count(*) FROM orders WHERE delivery_date = today AND status = 'out_for_delivery'),
    'delivered_today',  (SELECT count(*) FROM orders WHERE delivery_date = today AND status = 'delivered'),
    'cancelled_today',  (SELECT count(*) FROM orders WHERE delivery_date = today AND status = 'cancelled'),
    'failed_today',     (SELECT count(*) FROM deliveries d JOIN orders o ON o.id = d.order_id
                          WHERE o.delivery_date = today AND d.status = 'failed'),
    'riders_online',    (SELECT count(*) FROM riders WHERE online),
    'riders_active',    (SELECT count(*) FROM riders WHERE active),
    'customers_total',  (SELECT count(*) FROM profiles),
    'recharges_today',  coalesce((SELECT sum(amount) FROM wallet_transactions
                                  WHERE type = 'topup' AND created_at::date = today), 0),
    'refunds_today',    coalesce((SELECT sum(amount) FROM wallet_transactions
                                  WHERE type = 'refund' AND created_at::date = today), 0)
  ) INTO v;

  RETURN v;
END $$;

-- ── 2 & 3. Grant execute on growth + support KPI functions ──────────────────────
GRANT EXECUTE ON FUNCTION public.admin_growth_kpis()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_support_kpis() TO authenticated;

-- ── 4. Fix super_overview — same 'recharge' bug ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.super_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
DECLARE v jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'gmv_30d',               coalesce((SELECT sum(total) FROM orders WHERE created_at >= now() - interval '30 days' AND status <> 'cancelled'), 0),
    'gmv_lifetime',          coalesce((SELECT sum(total) FROM orders WHERE status <> 'cancelled'), 0),
    'orders_30d',            (SELECT count(*) FROM orders WHERE created_at >= now() - interval '30 days'),
    'orders_lifetime',       (SELECT count(*) FROM orders),
    'customers_total',       (SELECT count(*) FROM profiles),
    'customers_active_30d',  (SELECT count(DISTINCT user_id) FROM orders WHERE created_at >= now() - interval '30 days'),
    'wallet_balance_total',  coalesce((SELECT sum(balance) FROM wallets), 0),
    'recharges_30d',         coalesce((SELECT sum(amount) FROM wallet_transactions WHERE type = 'topup'   AND created_at >= now() - interval '30 days'), 0),
    'refunds_30d',           coalesce((SELECT sum(amount) FROM wallet_transactions WHERE type = 'refund' AND created_at >= now() - interval '30 days'), 0),
    'admins',                (SELECT count(*) FROM user_roles WHERE role IN ('admin','super_admin')),
    'riders',                (SELECT count(*) FROM riders WHERE active)
  ) INTO v;
  RETURN v;
END $$;

-- ── 5. Add orders to realtime publication so postgres_changes fires ───────────────
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
