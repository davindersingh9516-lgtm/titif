-- Admin finance report RPC — full P&L, GST, and income-tax data in one call.
--
-- Indian tax context applied:
--   GST   : Food services (SAC 9963) @ 5% (CGST 2.5% + SGST 2.5%), no ITC.
--           Mandatory registration when annual turnover > ₹20 L.
--           Prices assumed GST-inclusive — taxable value = revenue × 100/105.
--   IT    : Section 44AD presumptive taxation; digital receipts (UPI/wallet)
--           deemed profit @ 6% of gross receipts (< ₹2 Cr threshold).
--           Advance tax: single installment by 15 March.
--   TDS   : Section 194C applicable on rider contract payments > ₹30 K/yr.
--           Shown as a note; actual deduction outside this app's scope.

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
  -- Base: orders in date range (delivery_date = revenue recognition date)
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
  -- Wallet transactions in date range (created_at based = cash movement date)
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
  -- UPI payment receipts
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
  -- Daily series (every day in range, 0 if no orders)
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
  -- Weekly aggregate (for weekly chart mode)
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
    -- ── Period ────────────────────────────────────────────────────────────
    'period', jsonb_build_object(
      'from', p_from, 'to', p_to,
      'days', (p_to - p_from + 1)
    ),
    -- ── Revenue ───────────────────────────────────────────────────────────
    'revenue', jsonb_build_object(
      'gmv',              os.gmv,
      'refunds',          ra.refunds,
      'net',              os.gmv - ra.refunds,
      'orders',           os.orders_count,
      'cancelled',        os.cancelled_count,
      'refund_count',     ra.refund_count,
      'avg_order',        CASE WHEN os.orders_count > 0
                               THEN round(os.gmv / os.orders_count, 2) ELSE 0 END,
      'cancellation_rate', CASE WHEN (os.orders_count + os.cancelled_count) > 0
                               THEN round(os.cancelled_count * 100.0 /
                                    (os.orders_count + os.cancelled_count), 1) ELSE 0 END,
      'refund_rate',       CASE WHEN os.gmv > 0
                               THEN round(ra.refunds * 100.0 / os.gmv, 1) ELSE 0 END,
      'daily_avg',         CASE WHEN (p_to - p_from + 1) > 0
                               THEN round((os.gmv - ra.refunds) / (p_to - p_from + 1), 2) ELSE 0 END
    ),
    -- ── GST (SAC 9963, 5%, no ITC, GST-inclusive pricing assumed) ─────────
    'gst', jsonb_build_object(
      'sac_code',       '9963',
      'rate_pct',       5,
      'cgst_pct',       2.5,
      'sgst_pct',       2.5,
      'no_itc',         true,
      'inclusive',      true,
      'taxable_value',  round((os.gmv - ra.refunds) * 100.0 / 105, 2),
      'cgst',           round((os.gmv - ra.refunds) * 2.5  / 105, 2),
      'sgst',           round((os.gmv - ra.refunds) * 2.5  / 105, 2),
      'total_gst',      round((os.gmv - ra.refunds) * 5.0  / 105, 2),
      'monthly_liability', round((os.gmv - ra.refunds) * 5.0 / 105 /
                           GREATEST((p_to - p_from + 1), 1) * 30, 2)
    ),
    -- ── Income Tax — Section 44AD presumptive ─────────────────────────────
    'income_tax', jsonb_build_object(
      'section',            '44AD',
      'digital_rate_pct',   6,
      'cash_rate_pct',      8,
      'payment_mode',       'digital_upi',
      'gross_receipts',     os.gmv - ra.refunds,
      'taxable_receipts',   round((os.gmv - ra.refunds) * 100.0 / 105, 2),
      'presumptive_income', round((os.gmv - ra.refunds) * 100.0 / 105 * 6.0 / 100, 2),
      'threshold_crore',    2,
      'advance_tax_date',   '15 March'
    ),
    -- ── Cash flow ─────────────────────────────────────────────────────────
    'cash_flow', jsonb_build_object(
      'topups',              ta.topups,
      'topup_count',         ta.topup_count,
      'upi_collected',       pa.upi_collected,
      'upi_pending',         pa.upi_pending,
      'upi_failed',          pa.upi_failed,
      'upi_success_count',   pa.upi_success_count,
      'upi_pending_count',   pa.upi_pending_count,
      'refunds_paid',        ra.refunds,
      'wallet_float',        (SELECT coalesce(sum(balance), 0) FROM wallets),
      'net_cash_in',         ta.topups - ra.refunds
    ),
    -- ── Meal breakdown ────────────────────────────────────────────────────
    'meal_breakdown', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'meal_type',  mb.meal_type,
          'orders',     mb.orders,
          'revenue',    mb.revenue,
          'share_pct',  CASE WHEN os.gmv > 0
                             THEN round(mb.revenue * 100.0 / NULLIF(os.gmv, 0), 1)
                             ELSE 0 END,
          'avg_order',  CASE WHEN mb.orders > 0 THEN round(mb.revenue / mb.orders, 2) ELSE 0 END
        )
      ), '[]'::jsonb)
      FROM meal_breakdown mb
    ),
    -- ── Daily series (all days, 0-filled) ─────────────────────────────────
    'daily_series', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue', d.revenue)
      ), '[]'::jsonb)
      FROM daily d
    ),
    -- ── Weekly series ─────────────────────────────────────────────────────
    'weekly_series', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('week', w.week_start, 'orders', w.orders, 'revenue', w.revenue)
      ), '[]'::jsonb)
      FROM weekly w
    )
  ) INTO v
  FROM order_summary os, refund_agg ra, topup_agg ta, payment_agg pa;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_finance_report(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_finance_report(date, date) TO authenticated;
