-- Auto-advance order delivery status based on delivery window times (IST).
-- Auto-generate subscription orders daily at midnight IST.
--
-- Delivery windows (from app settings / WINDOW_LABEL):
--   Breakfast : 07:00 – 09:00 IST   → auto out_for_delivery @07:00, auto delivered @09:30
--   Lunch     : 12:00 – 14:00 IST   → auto out_for_delivery @12:00, auto delivered @14:30
--   Dinner    : 19:00 – 21:00 IST   → auto out_for_delivery @19:00, auto delivered @21:30
--
-- Trigger for out_for_delivery: at least one kitchen_batch for that meal+date is dispatched.
-- Trigger for delivered        : 30 min after window ends, regardless of batch state.

CREATE OR REPLACE FUNCTION public.auto_advance_delivery_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ist   timestamptz;
  v_today date;
  v_mins  int;          -- minutes since midnight IST
BEGIN
  v_ist   := now() AT TIME ZONE 'Asia/Kolkata';
  v_today := v_ist::date;
  v_mins  := extract(hour  FROM v_ist)::int * 60
           + extract(minute FROM v_ist)::int;

  -- ── placed / preparing → out_for_delivery ──────────────────────────────
  -- Fires only when a batch for that meal+date has been dispatched.

  -- Breakfast window starts 07:00 IST (420 min)
  IF v_mins >= 420 AND EXISTS (
    SELECT 1 FROM public.kitchen_batches
    WHERE delivery_date = v_today AND meal_type = 'breakfast' AND status = 'dispatched'
  ) THEN
    UPDATE public.orders
    SET    status = 'out_for_delivery', updated_at = now()
    WHERE  delivery_date = v_today
      AND  meal_type     = 'breakfast'
      AND  status        IN ('placed', 'preparing');
  END IF;

  -- Lunch window starts 12:00 IST (720 min)
  IF v_mins >= 720 AND EXISTS (
    SELECT 1 FROM public.kitchen_batches
    WHERE delivery_date = v_today AND meal_type = 'lunch' AND status = 'dispatched'
  ) THEN
    UPDATE public.orders
    SET    status = 'out_for_delivery', updated_at = now()
    WHERE  delivery_date = v_today
      AND  meal_type     = 'lunch'
      AND  status        IN ('placed', 'preparing');
  END IF;

  -- Dinner window starts 19:00 IST (1140 min)
  IF v_mins >= 1140 AND EXISTS (
    SELECT 1 FROM public.kitchen_batches
    WHERE delivery_date = v_today AND meal_type = 'dinner' AND status = 'dispatched'
  ) THEN
    UPDATE public.orders
    SET    status = 'out_for_delivery', updated_at = now()
    WHERE  delivery_date = v_today
      AND  meal_type     = 'dinner'
      AND  status        IN ('placed', 'preparing');
  END IF;

  -- ── out_for_delivery → delivered (30 min after window end) ─────────────

  -- Breakfast ends 09:00 → deliver at 09:30 IST (570 min)
  IF v_mins >= 570 THEN
    UPDATE public.orders
    SET    status = 'delivered', updated_at = now()
    WHERE  delivery_date = v_today
      AND  meal_type     = 'breakfast'
      AND  status        = 'out_for_delivery';
  END IF;

  -- Lunch ends 14:00 → deliver at 14:30 IST (870 min)
  IF v_mins >= 870 THEN
    UPDATE public.orders
    SET    status = 'delivered', updated_at = now()
    WHERE  delivery_date = v_today
      AND  meal_type     = 'lunch'
      AND  status        = 'out_for_delivery';
  END IF;

  -- Dinner ends 21:00 → deliver at 21:30 IST (1290 min)
  IF v_mins >= 1290 THEN
    UPDATE public.orders
    SET    status = 'delivered', updated_at = now()
    WHERE  delivery_date = v_today
      AND  meal_type     = 'dinner'
      AND  status        = 'out_for_delivery';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.auto_advance_delivery_status() TO service_role;

-- ── pg_cron jobs ────────────────────────────────────────────────────────────
-- pg_cron must be enabled: Supabase dashboard → Database → Extensions → pg_cron
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — skipping cron job registration. Enable it in Supabase Extensions and re-run this migration.';
    RETURN;
  END IF;

  -- Auto-advance delivery status every 15 minutes
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-advance-delivery-status') THEN
    PERFORM cron.unschedule('auto-advance-delivery-status');
  END IF;
  PERFORM cron.schedule(
    'auto-advance-delivery-status',
    '*/15 * * * *',
    'SELECT public.auto_advance_delivery_status()'
  );

  -- Auto-generate subscription orders daily at midnight IST = 18:30 UTC
  -- (now() AT TIME ZONE 'Asia/Kolkata')::date gives the IST calendar date at run time
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-generate-subscriptions') THEN
    PERFORM cron.unschedule('auto-generate-subscriptions');
  END IF;
  PERFORM cron.schedule(
    'auto-generate-subscriptions',
    '30 18 * * *',
    'SELECT public.generate_subscription_orders(((now() AT TIME ZONE ''Asia/Kolkata''))::date)'
  );

END $$;
