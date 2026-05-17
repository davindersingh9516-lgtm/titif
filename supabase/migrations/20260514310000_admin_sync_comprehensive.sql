-- ============================================================
-- Admin Sync Comprehensive Fix
-- Covers migrations 270000–300000 with idempotent wrappers.
-- Safe to run even if those migrations were already applied.
--
-- Fixes:
--  1. wallets.user_id → profiles FK  (NEW — customers page join was failing silently)
--  2. orders.user_id  → profiles FK  (was: 270000 — orders page PGRST200)
--  3. admin_kpis 'recharge' → 'topup' (was: 260000/290000 — 400 on dashboard)
--  4. super_overview same enum fix
--  5. cancel_order_with_refund notification guard (was: 280000)
--  6. admin_finance_report RPC (was: 300000)
--  7. GRANTs for growth/support KPI functions
--  8. Realtime: REPLICA IDENTITY FULL + safe publication add for orders + profiles
-- ============================================================


-- ── 1. FK: wallets.user_id → profiles.id ─────────────────────────────────────
-- PostgREST needs this to resolve  profiles.select("*, wallets(balance)")
DO $$ BEGIN
  ALTER TABLE public.wallets
    ADD CONSTRAINT wallets_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── 2. FK: orders.user_id → profiles.id ──────────────────────────────────────
-- PostgREST needs this to resolve  orders.select("*, profiles:orders_user_id_profiles_fkey(...)")
DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── 3. admin_kpis: fix 'recharge' → 'topup' ──────────────────────────────────
-- wallet_tx_type enum values: topup | order_debit | refund | adjustment
-- 'recharge' is NOT a valid value — causes runtime cast error → 400 on every call.
CREATE OR REPLACE FUNCTION public.admin_kpis()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
DECLARE
  v     jsonb;
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


-- ── 4. super_overview: same 'recharge' → 'topup' fix ─────────────────────────
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
    'recharges_30d',         coalesce((SELECT sum(amount) FROM wallet_transactions WHERE type = 'topup'  AND created_at >= now() - interval '30 days'), 0),
    'refunds_30d',           coalesce((SELECT sum(amount) FROM wallet_transactions WHERE type = 'refund' AND created_at >= now() - interval '30 days'), 0),
    'admins',                (SELECT count(*) FROM user_roles WHERE role IN ('admin','super_admin')),
    'riders',                (SELECT count(*) FROM riders WHERE active)
  ) INTO v;
  RETURN v;
END $$;


-- ── 5. cancel_order_with_refund: guard notify so refund never rolls back ───────
CREATE OR REPLACE FUNCTION public.cancel_order_with_refund(
  p_order_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid    := auth.uid();
  v_order    public.orders%rowtype;
  v_balance  numeric;
  v_is_admin boolean := public.is_admin(v_uid);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.user_id <> v_uid AND NOT v_is_admin THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_order.status IN ('cancelled', 'delivered') THEN RETURN; END IF;
  IF NOT v_is_admin AND now() > public.cutoff_for(v_order.meal_type, v_order.delivery_date) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_events(order_id, status, actor_id, note)
    VALUES (p_order_id, 'cancelled', v_uid, coalesce(p_reason, 'Cancelled'));

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_order.user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (v_order.user_id, 0);
    v_balance := 0;
  END IF;

  UPDATE public.wallets
    SET balance = balance + v_order.total, updated_at = now()
    WHERE user_id = v_order.user_id;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
    VALUES (v_order.user_id, 'refund', v_order.total, v_balance + v_order.total,
            'Refund for cancelled order', p_order_id);

  -- Notification failure must NEVER roll back the wallet refund
  BEGIN
    PERFORM public.notify_user(
      v_order.user_id, 'order_cancelled',
      'Order cancelled',
      'Your order was cancelled. ₹' || v_order.total::text || ' refunded to your wallet instantly.',
      '/app/wallet',
      jsonb_build_object('order_id', p_order_id, 'reason', p_reason, 'refund', v_order.total),
      ARRAY['in_app', 'whatsapp'], 3
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;


-- ── 6. admin_finance_report RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_finance_report(
  p_from date DEFAULT (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'))::date,
  p_to   date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH
  order_base AS (
    SELECT id, meal_type, total, status, delivery_date
    FROM orders
    WHERE delivery_date BETWEEN p_from AND p_to
  ),
  order_summary AS (
    SELECT
      coalesce(sum(total)  FILTER (WHERE status <> 'cancelled'), 0)::numeric AS gmv,
      count(*)             FILTER (WHERE status <> 'cancelled')              AS orders_count,
      count(*)             FILTER (WHERE status = 'cancelled')               AS cancelled_count
    FROM order_base
  ),
  meal_breakdown AS (
    SELECT
      meal_type::text,
      count(*)    FILTER (WHERE status <> 'cancelled')                      AS orders,
      coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS revenue
    FROM order_base
    GROUP BY meal_type
  ),
  refund_agg AS (
    SELECT coalesce(sum(amount), 0)::numeric AS refunds,
           count(*)                          AS refund_count
    FROM wallet_transactions
    WHERE type = 'refund'
      AND created_at::date BETWEEN p_from AND p_to
  ),
  topup_agg AS (
    SELECT coalesce(sum(amount), 0)::numeric AS topups,
           count(*)                          AS topup_count
    FROM wallet_transactions
    WHERE type = 'topup'
      AND created_at::date BETWEEN p_from AND p_to
  ),
  payment_agg AS (
    SELECT
      coalesce(sum(amount) FILTER (WHERE status = 'success'), 0)::numeric AS upi_collected,
      count(*)             FILTER (WHERE status = 'success')              AS upi_success_count,
      coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0)::numeric AS upi_pending,
      count(*)             FILTER (WHERE status = 'pending')              AS upi_pending_count,
      coalesce(sum(amount) FILTER (WHERE status = 'failed'),  0)::numeric AS upi_failed,
      count(*)             FILTER (WHERE status = 'failed')               AS upi_failed_count
    FROM payments
    WHERE created_at::date BETWEEN p_from AND p_to
  ),
  date_series AS (
    SELECT generate_series(p_from, p_to, '1 day'::interval)::date AS day
  ),
  daily AS (
    SELECT
      ds.day,
      count(o.id)    FILTER (WHERE o.status <> 'cancelled')              AS orders,
      coalesce(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)   AS revenue
    FROM date_series ds
    LEFT JOIN order_base o ON o.delivery_date = ds.day
    GROUP BY ds.day
    ORDER BY ds.day
  ),
  weekly AS (
    SELECT
      date_trunc('week', ds.day)::date                                   AS week_start,
      count(o.id)    FILTER (WHERE o.status <> 'cancelled')              AS orders,
      coalesce(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)   AS revenue
    FROM date_series ds
    LEFT JOIN order_base o ON o.delivery_date = ds.day
    GROUP BY date_trunc('week', ds.day)
    ORDER BY week_start
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', (p_to - p_from + 1)),
    'revenue', jsonb_build_object(
      'gmv',               os.gmv,
      'refunds',           ra.refunds,
      'net',               os.gmv - ra.refunds,
      'orders',            os.orders_count,
      'cancelled',         os.cancelled_count,
      'refund_count',      ra.refund_count,
      'avg_order',         CASE WHEN os.orders_count > 0 THEN round(os.gmv / os.orders_count, 2) ELSE 0 END,
      'cancellation_rate', CASE WHEN (os.orders_count + os.cancelled_count) > 0
                                THEN round(os.cancelled_count * 100.0 / (os.orders_count + os.cancelled_count), 1) ELSE 0 END,
      'refund_rate',       CASE WHEN os.gmv > 0 THEN round(ra.refunds * 100.0 / os.gmv, 1) ELSE 0 END,
      'daily_avg',         CASE WHEN (p_to - p_from + 1) > 0
                                THEN round((os.gmv - ra.refunds) / (p_to - p_from + 1), 2) ELSE 0 END
    ),
    'gst', jsonb_build_object(
      'sac_code', '9963', 'rate_pct', 5, 'cgst_pct', 2.5, 'sgst_pct', 2.5,
      'no_itc', true, 'inclusive', true,
      'taxable_value',     round((os.gmv - ra.refunds) * 100.0 / 105, 2),
      'cgst',              round((os.gmv - ra.refunds) * 2.5  / 105, 2),
      'sgst',              round((os.gmv - ra.refunds) * 2.5  / 105, 2),
      'total_gst',         round((os.gmv - ra.refunds) * 5.0  / 105, 2),
      'monthly_liability', round((os.gmv - ra.refunds) * 5.0 / 105 / GREATEST((p_to - p_from + 1), 1) * 30, 2)
    ),
    'income_tax', jsonb_build_object(
      'section', '44AD', 'digital_rate_pct', 6, 'cash_rate_pct', 8, 'payment_mode', 'digital_upi',
      'gross_receipts',     os.gmv - ra.refunds,
      'taxable_receipts',   round((os.gmv - ra.refunds) * 100.0 / 105, 2),
      'presumptive_income', round((os.gmv - ra.refunds) * 100.0 / 105 * 6.0 / 100, 2),
      'threshold_crore', 2, 'advance_tax_date', '15 March'
    ),
    'cash_flow', jsonb_build_object(
      'topups',            ta.topups,
      'topup_count',       ta.topup_count,
      'upi_collected',     pa.upi_collected,
      'upi_pending',       pa.upi_pending,
      'upi_failed',        pa.upi_failed,
      'upi_success_count', pa.upi_success_count,
      'upi_pending_count', pa.upi_pending_count,
      'refunds_paid',      ra.refunds,
      'wallet_float',      (SELECT coalesce(sum(balance), 0) FROM wallets),
      'net_cash_in',       ta.topups - ra.refunds
    ),
    'meal_breakdown', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'meal_type',  mb.meal_type,
        'orders',     mb.orders,
        'revenue',    mb.revenue,
        'share_pct',  CASE WHEN os.gmv > 0 THEN round(mb.revenue * 100.0 / NULLIF(os.gmv, 0), 1) ELSE 0 END,
        'avg_order',  CASE WHEN mb.orders > 0 THEN round(mb.revenue / mb.orders, 2) ELSE 0 END
      )), '[]'::jsonb)
      FROM meal_breakdown mb
    ),
    'daily_series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue', d.revenue)), '[]'::jsonb)
      FROM daily d
    ),
    'weekly_series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('week', w.week_start, 'orders', w.orders, 'revenue', w.revenue)), '[]'::jsonb)
      FROM weekly w
    )
  ) INTO v
  FROM order_summary os, refund_agg ra, topup_agg ta, payment_agg pa;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_finance_report(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_finance_report(date, date) TO authenticated;


-- ── 7. GRANTs for analytics functions (idempotent) ───────────────────────────
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION public.admin_growth_kpis()  TO authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION public.admin_support_kpis() TO authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ── 8. Realtime: orders + profiles ───────────────────────────────────────────
ALTER TABLE public.orders   REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
