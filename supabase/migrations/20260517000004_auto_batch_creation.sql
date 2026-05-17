-- Auto batch creation: creates R1 kitchen batches at meal cutoff times
-- Runs via pg_cron without is_admin() auth check (SECURITY DEFINER bypass)
-- Scheduled: breakfast at 12:05 AM IST (18:35 UTC), lunch at 10:05 AM IST (04:35 UTC), dinner at 3:05 PM IST (09:35 UTC)

CREATE OR REPLACE FUNCTION public.auto_create_meal_batches(p_meal meal_type)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date   date;
  v_id     uuid;
  v_mini   int;
  v_large  int;
  v_fixed  int;
BEGIN
  v_date := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- Skip if a batch already exists for this meal + date
  IF EXISTS (
    SELECT 1 FROM public.kitchen_batches
    WHERE delivery_date = v_date AND meal_type = p_meal
  ) THEN
    RETURN;
  END IF;

  -- Skip if no active orders exist (nothing to batch)
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE delivery_date = v_date
      AND meal_type = p_meal
      AND status NOT IN ('cancelled', 'delivered')
  ) THEN
    RETURN;
  END IF;

  -- Create the batch (created_by = NULL for auto-system batches)
  INSERT INTO public.kitchen_batches(delivery_date, meal_type, round_label, created_by)
    VALUES (v_date, p_meal, 'R1', NULL)
    RETURNING id INTO v_id;

  -- Assign all unbatched, non-cancelled orders
  UPDATE public.orders
    SET batch_id = v_id, updated_at = now()
    WHERE delivery_date = v_date
      AND meal_type = p_meal
      AND batch_id IS NULL
      AND status NOT IN ('cancelled', 'delivered');

  -- Update planned counts from order items
  SELECT
    COALESCE(SUM(CASE WHEN oi.size = 'mini'  THEN oi.qty END), 0),
    COALESCE(SUM(CASE WHEN oi.size = 'large' THEN oi.qty END), 0),
    COALESCE(SUM(CASE WHEN oi.size = 'fixed' THEN oi.qty END), 0)
  INTO v_mini, v_large, v_fixed
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.batch_id = v_id;

  UPDATE public.kitchen_batches
    SET planned_mini = v_mini, planned_large = v_large, planned_breakfast = v_fixed
    WHERE id = v_id;
END $$;

-- Grant execute to service role so pg_cron can call it
GRANT EXECUTE ON FUNCTION public.auto_create_meal_batches(meal_type) TO service_role;

-- Schedule with pg_cron (only if extension is enabled)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Remove existing jobs if re-running migration
    PERFORM cron.unschedule(jobname)
      FROM cron.job
      WHERE jobname IN ('auto-batch-breakfast', 'auto-batch-lunch', 'auto-batch-dinner');

    -- Breakfast: cutoff 11:59 PM IST → batch at 12:05 AM IST = 18:35 UTC
    PERFORM cron.schedule(
      'auto-batch-breakfast',
      '35 18 * * *',
      $cmd$SELECT public.auto_create_meal_batches('breakfast'::meal_type)$cmd$
    );

    -- Lunch: cutoff 10:00 AM IST → batch at 10:05 AM IST = 04:35 UTC
    PERFORM cron.schedule(
      'auto-batch-lunch',
      '35 4 * * *',
      $cmd$SELECT public.auto_create_meal_batches('lunch'::meal_type)$cmd$
    );

    -- Dinner: cutoff 3:00 PM IST → batch at 3:05 PM IST = 09:35 UTC
    PERFORM cron.schedule(
      'auto-batch-dinner',
      '35 9 * * *',
      $cmd$SELECT public.auto_create_meal_batches('dinner'::meal_type)$cmd$
    );

  END IF;
END $$;
