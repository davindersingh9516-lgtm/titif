-- Materialized view for admin analytics — avoids repeated full table scans
-- on orders for the 30-day rolling dashboard charts.
-- Refresh: called by retention-scan cron or manual trigger.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.admin_daily_stats AS
  SELECT
    delivery_date                                                     AS day,
    count(*)::bigint                                                  AS orders,
    count(*) FILTER (WHERE status = 'delivered')::bigint             AS delivered,
    count(*) FILTER (WHERE status = 'cancelled')::bigint             AS cancelled,
    coalesce(sum(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)::numeric AS revenue
  FROM public.orders
  WHERE delivery_date >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY delivery_date;

CREATE UNIQUE INDEX IF NOT EXISTS admin_daily_stats_day_idx ON public.admin_daily_stats (day);

-- Function: refresh the view concurrently (no table lock)
CREATE OR REPLACE FUNCTION public.refresh_admin_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_daily_stats;
END $$;

REVOKE ALL ON FUNCTION public.refresh_admin_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.refresh_admin_stats() TO authenticated;

-- Update admin_daily_series to hit the MV for historical days,
-- falling back to live query for today (always fresh).
CREATE OR REPLACE FUNCTION public.admin_daily_series(p_days int DEFAULT 14)
RETURNS TABLE(day date, orders bigint, revenue numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
  WITH date_series AS (
    SELECT generate_series(
      (now() AT TIME ZONE 'Asia/Kolkata')::date - (p_days - 1),
      (now() AT TIME ZONE 'Asia/Kolkata')::date,
      '1 day'
    )::date AS day
  )
  SELECT
    ds.day,
    coalesce(
      CASE
        -- Today: always query live data
        WHEN ds.day = (now() AT TIME ZONE 'Asia/Kolkata')::date
          THEN (SELECT count(*)::bigint FROM orders WHERE delivery_date = ds.day)
        -- Historical: use materialized view
        ELSE (SELECT mv.orders FROM admin_daily_stats mv WHERE mv.day = ds.day)
      END,
      0
    ) AS orders,
    coalesce(
      CASE
        WHEN ds.day = (now() AT TIME ZONE 'Asia/Kolkata')::date
          THEN (SELECT coalesce(sum(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)
                FROM orders WHERE delivery_date = ds.day)
        ELSE (SELECT mv.revenue FROM admin_daily_stats mv WHERE mv.day = ds.day)
      END,
      0
    ) AS revenue
  FROM date_series ds
  ORDER BY ds.day;
$$;
