-- Fix admin_subscription_kpis: total_active was incorrectly date-filtered.
-- Both subscriptions starting tomorrow showed as 0 active today.
-- total_active now counts ALL subscriptions with status='active', regardless of date.

CREATE OR REPLACE FUNCTION public.admin_subscription_kpis(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_date date;
  v      jsonb;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_date := coalesce(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);

  WITH active_subs AS (
    -- Only subscriptions active on the target date (for per-meal counts)
    SELECT s.id, s.user_id, unnest(s.meal_types) AS meal
    FROM public.subscriptions s
    WHERE s.status = 'active'
      AND v_date BETWEEN s.start_date AND s.end_date
  ),
  not_paused AS (
    SELECT a.* FROM active_subs a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.subscription_pauses p
      WHERE p.subscription_id = a.id
        AND p.pause_date = v_date
        AND p.meal_type = a.meal
    )
  ),
  already_ordered AS (
    SELECT a.* FROM active_subs a
    WHERE EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.user_id = a.user_id
        AND o.delivery_date = v_date
        AND o.meal_type = a.meal
        AND o.status <> 'cancelled'
    )
  )
  SELECT jsonb_build_object(
    'date',               v_date,
    -- total_active = ALL active subscriptions (not date-filtered)
    'total_active',       (SELECT count(*) FROM public.subscriptions WHERE status = 'active'),
    'breakfast_total',    (SELECT count(*) FROM active_subs WHERE meal = 'breakfast'),
    'lunch_total',        (SELECT count(*) FROM active_subs WHERE meal = 'lunch'),
    'dinner_total',       (SELECT count(*) FROM active_subs WHERE meal = 'dinner'),
    'breakfast_pending',  (SELECT count(*) FROM not_paused WHERE meal = 'breakfast') -
                          (SELECT count(*) FROM already_ordered WHERE meal = 'breakfast'),
    'lunch_pending',      (SELECT count(*) FROM not_paused WHERE meal = 'lunch') -
                          (SELECT count(*) FROM already_ordered WHERE meal = 'lunch'),
    'dinner_pending',     (SELECT count(*) FROM not_paused WHERE meal = 'dinner') -
                          (SELECT count(*) FROM already_ordered WHERE meal = 'dinner'),
    'breakfast_ordered',  (SELECT count(*) FROM already_ordered WHERE meal = 'breakfast'),
    'lunch_ordered',      (SELECT count(*) FROM already_ordered WHERE meal = 'lunch'),
    'dinner_ordered',     (SELECT count(*) FROM already_ordered WHERE meal = 'dinner'),
    'total_paused_today', (SELECT count(*) FROM active_subs) -
                          (SELECT count(*) FROM not_paused)
  ) INTO v;

  RETURN v;
END $$;
