-- ============================================================
-- Subscription Discount: 10% off when
--   1. Subscription size = 'large'
--   2. At least 2 meal types subscribed
--   3. Never more than 2 consecutive fully-paused days
--
-- A "break day" = ALL subscribed meals paused on that date.
-- 3+ consecutive break days → discount_pct set to 0 permanently
--   for that subscription cycle.
-- Discount re-evaluation runs automatically on every pause/resume.
-- ============================================================


-- ── 1. Add discount_pct column ────────────────────────────────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS discount_pct integer NOT NULL DEFAULT 0;


-- ── 2. recalculate_subscription_discount ─────────────────────────────────────
-- Determines eligibility and sets discount_pct on the subscription.
-- Called after every create / pause / resume.
CREATE OR REPLACE FUNCTION public.recalculate_subscription_discount(p_sub_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub           public.subscriptions%rowtype;
  v_meal_count    int;
  v_pause_date    date;
  v_prev_date     date := NULL;
  v_cur_consec    int  := 0;
  v_max_consec    int  := 0;
  v_new_pct       int;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_meal_count := cardinality(v_sub.meal_types);

  -- Not eligible: need large size AND 2+ meal types
  IF v_sub.size <> 'large' OR v_meal_count < 2 THEN
    UPDATE public.subscriptions SET discount_pct = 0, updated_at = now() WHERE id = p_sub_id;
    RETURN;
  END IF;

  -- Find "break days": days where every subscribed meal is paused
  FOR v_pause_date IN
    SELECT sp.pause_date
    FROM public.subscription_pauses sp
    WHERE sp.subscription_id = p_sub_id
    GROUP BY sp.pause_date
    HAVING count(DISTINCT sp.meal_type) >= v_meal_count
    ORDER BY sp.pause_date
  LOOP
    IF v_prev_date IS NOT NULL AND v_pause_date = v_prev_date + 1 THEN
      v_cur_consec := v_cur_consec + 1;
    ELSE
      v_cur_consec := 1;
    END IF;
    IF v_cur_consec > v_max_consec THEN
      v_max_consec := v_cur_consec;
    END IF;
    v_prev_date := v_pause_date;
  END LOOP;

  -- More than 2 consecutive break days = forfeit discount
  v_new_pct := CASE WHEN v_max_consec > 2 THEN 0 ELSE 10 END;

  UPDATE public.subscriptions
    SET discount_pct = v_new_pct, updated_at = now()
  WHERE id = p_sub_id;
END $$;


-- ── 3. create_subscription: set initial discount ──────────────────────────────
CREATE OR REPLACE FUNCTION public.create_subscription(
  p_meal_types      public.meal_type[],
  p_size            public.meal_size    DEFAULT 'mini',
  p_window          public.delivery_window DEFAULT 'round_1',
  p_address         text               DEFAULT NULL,
  p_lat             double precision   DEFAULT NULL,
  p_lng             double precision   DEFAULT NULL,
  p_start_date      date               DEFAULT NULL,
  p_notes           text               DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_start  date;
  v_end    date;
  v_sub_id uuid;
  v_addr   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_meal_types IS NULL OR cardinality(p_meal_types) = 0 THEN
    RAISE EXCEPTION 'select_at_least_one_meal';
  END IF;

  v_addr := p_address;
  IF v_addr IS NULL OR length(trim(v_addr)) < 5 THEN
    SELECT address INTO v_addr FROM public.profiles WHERE id = v_uid;
  END IF;
  IF v_addr IS NULL OR length(trim(v_addr)) < 5 THEN
    RAISE EXCEPTION 'invalid_address';
  END IF;

  v_start := coalesce(p_start_date, (now() AT TIME ZONE 'Asia/Kolkata')::date + 1);
  v_end   := v_start + 29;

  -- Cancel any existing active/paused subscription
  UPDATE public.subscriptions
    SET status = 'cancelled', updated_at = now()
  WHERE user_id = v_uid AND status IN ('active', 'paused');

  INSERT INTO public.subscriptions(
    user_id, meal_types, size, delivery_window, address, lat, lng,
    start_date, end_date, status, notes
  ) VALUES (
    v_uid, p_meal_types, p_size, p_window, v_addr, p_lat, p_lng,
    v_start, v_end, 'active', p_notes
  ) RETURNING id INTO v_sub_id;

  -- Set initial discount based on eligibility (no pauses yet so discount = 10 if eligible)
  PERFORM public.recalculate_subscription_discount(v_sub_id);

  RETURN v_sub_id;
END $$;


-- ── 4. pause_subscription_day: recalculate discount after pause ───────────────
CREATE OR REPLACE FUNCTION public.pause_subscription_day(
  p_sub_id    uuid,
  p_date      date,
  p_meal_type public.meal_type
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_sub  public.subscriptions%rowtype;
  v_oid  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  IF v_sub.user_id <> v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_date NOT BETWEEN v_sub.start_date AND v_sub.end_date THEN
    RAISE EXCEPTION 'date_out_of_range';
  END IF;
  IF NOT (p_meal_type = ANY(v_sub.meal_types)) THEN
    RAISE EXCEPTION 'meal_not_in_subscription';
  END IF;
  IF NOT public.is_admin(v_uid) AND now() > public.cutoff_for(p_meal_type, p_date) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  INSERT INTO public.subscription_pauses(subscription_id, user_id, pause_date, meal_type)
    VALUES (p_sub_id, v_sub.user_id, p_date, p_meal_type)
    ON CONFLICT DO NOTHING;

  -- Cancel any already-placed order for this day/meal
  SELECT id INTO v_oid
    FROM public.orders
    WHERE user_id = v_sub.user_id
      AND delivery_date = p_date
      AND meal_type = p_meal_type
      AND status NOT IN ('cancelled', 'delivered')
    LIMIT 1;

  IF v_oid IS NOT NULL THEN
    UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_oid;
    INSERT INTO public.order_events(order_id, status, actor_id, note)
      VALUES (v_oid, 'cancelled', v_uid, 'Subscription day paused');

    UPDATE public.wallets
      SET balance = balance + (SELECT total FROM public.orders WHERE id = v_oid),
          updated_at = now()
      WHERE user_id = v_sub.user_id;

    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
      SELECT v_sub.user_id, 'refund', o.total,
             (SELECT balance FROM public.wallets WHERE user_id = v_sub.user_id),
             'Subscription pause refund', v_oid
      FROM public.orders o WHERE o.id = v_oid;
  END IF;

  -- Recalculate discount — consecutive break days may forfeit it
  PERFORM public.recalculate_subscription_discount(p_sub_id);
END $$;


-- ── 5. resume_subscription_day: recalculate discount after resume ─────────────
CREATE OR REPLACE FUNCTION public.resume_subscription_day(
  p_sub_id    uuid,
  p_date      date,
  p_meal_type public.meal_type
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  IF v_sub.user_id <> v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT public.is_admin(v_uid) AND now() > public.cutoff_for(p_meal_type, p_date) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  DELETE FROM public.subscription_pauses
    WHERE subscription_id = p_sub_id
      AND pause_date = p_date
      AND meal_type = p_meal_type;

  -- Recalculate discount — resuming might restore it
  PERFORM public.recalculate_subscription_discount(p_sub_id);
END $$;


-- ── 6. generate_subscription_orders: apply discount to order price ────────────
CREATE OR REPLACE FUNCTION public.generate_subscription_orders(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_date          date;
  v_sub           RECORD;
  v_meal          public.meal_type;
  v_menu          RECORD;
  v_balance       numeric;
  v_price         numeric;
  v_otp           text;
  v_order_id      uuid;
  v_created       int := 0;
  v_skip_exist    int := 0;
  v_skip_pause    int := 0;
  v_skip_wallet   int := 0;
  v_errors        int := 0;
  v_item_name     text;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_date := coalesce(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);

  FOR v_sub IN
    SELECT s.* FROM public.subscriptions s
    WHERE s.status = 'active'
      AND v_date BETWEEN s.start_date AND s.end_date
  LOOP
    FOREACH v_meal IN ARRAY v_sub.meal_types LOOP
      BEGIN
        -- Skip if paused
        IF EXISTS (
          SELECT 1 FROM public.subscription_pauses
          WHERE subscription_id = v_sub.id
            AND pause_date = v_date
            AND meal_type = v_meal
        ) THEN
          v_skip_pause := v_skip_pause + 1;
          CONTINUE;
        END IF;

        -- Skip if order already exists
        IF EXISTS (
          SELECT 1 FROM public.orders
          WHERE user_id = v_sub.user_id
            AND delivery_date = v_date
            AND meal_type = v_meal
            AND status <> 'cancelled'
        ) THEN
          v_skip_exist := v_skip_exist + 1;
          CONTINUE;
        END IF;

        -- Find matching menu item
        SELECT id, name, size, price INTO v_menu
          FROM public.menu_items
          WHERE meal_type = v_meal
            AND (
              (v_meal = 'breakfast' AND size = 'fixed')
              OR (v_meal <> 'breakfast' AND size = v_sub.size)
            )
            AND active = true
          ORDER BY price ASC
          LIMIT 1;

        IF v_menu IS NULL THEN
          v_errors := v_errors + 1;
          CONTINUE;
        END IF;

        -- Apply discount if eligible
        v_price := CASE
          WHEN v_sub.discount_pct > 0
            THEN round(v_menu.price * (1 - v_sub.discount_pct::numeric / 100), 0)
          ELSE v_menu.price
        END;

        v_item_name := v_menu.name ||
          CASE WHEN v_sub.discount_pct > 0 THEN ' (' || v_sub.discount_pct || '% off)' ELSE '' END;

        -- Check wallet
        SELECT balance INTO v_balance
          FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;

        IF v_balance IS NULL OR v_balance < v_price THEN
          v_skip_wallet := v_skip_wallet + 1;
          BEGIN
            PERFORM public.notify_user(
              v_sub.user_id, 'low_wallet',
              'Low wallet balance',
              'Your subscription order for ' || initcap(v_meal::text) || ' on ' || v_date::text || ' could not be placed. Please top up.',
              '/app/wallet',
              jsonb_build_object('meal', v_meal, 'date', v_date, 'required', v_price, 'balance', v_balance),
              ARRAY['in_app'], 2
            );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
          CONTINUE;
        END IF;

        -- Place order
        v_otp := lpad((floor(random() * 10000))::text, 4, '0');

        INSERT INTO public.orders(
          user_id, meal_type, delivery_date, delivery_window, status,
          subtotal, total, address, lat, lng, delivery_otp, notes
        ) VALUES (
          v_sub.user_id, v_meal, v_date, v_sub.delivery_window, 'placed',
          v_price, v_price,
          v_sub.address, v_sub.lat, v_sub.lng,
          v_otp,
          CASE WHEN v_sub.discount_pct > 0
            THEN '📅 Subscription · ' || v_sub.discount_pct || '% loyalty discount applied'
            ELSE '📅 Subscription order'
          END
        ) RETURNING id INTO v_order_id;

        INSERT INTO public.order_items(order_id, name, size, price, qty)
          VALUES (v_order_id, v_item_name, v_menu.size, v_price, 1);

        UPDATE public.wallets
          SET balance = balance - v_price, updated_at = now()
          WHERE user_id = v_sub.user_id;

        INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
          VALUES (v_sub.user_id, 'order_debit', -v_price, v_balance - v_price,
                  initcap(v_meal::text) || ' subscription' ||
                  CASE WHEN v_sub.discount_pct > 0 THEN ' (' || v_sub.discount_pct || '% off)' ELSE '' END,
                  v_order_id);

        INSERT INTO public.order_events(order_id, status, actor_id, note)
          VALUES (v_order_id, 'placed', v_uid,
                  'Auto-placed by subscription' ||
                  CASE WHEN v_sub.discount_pct > 0 THEN ' · ' || v_sub.discount_pct || '% discount' ELSE '' END);

        BEGIN
          PERFORM public.notify_user(
            v_sub.user_id, 'order_confirmed',
            'Subscription order placed',
            'Your ' || initcap(v_meal::text) || ' order for today: ₹' || v_price::text ||
            CASE WHEN v_sub.discount_pct > 0 THEN ' (after ' || v_sub.discount_pct || '% loyalty discount)' ELSE '' END,
            '/app/orders',
            jsonb_build_object('order_id', v_order_id, 'meal', v_meal, 'total', v_price,
                               'discount_pct', v_sub.discount_pct),
            ARRAY['in_app'], 2
          );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        v_created := v_created + 1;

      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'date',               v_date,
    'created',            v_created,
    'skipped_existing',   v_skip_exist,
    'skipped_paused',     v_skip_pause,
    'skipped_low_wallet', v_skip_wallet,
    'errors',             v_errors
  );
END $$;


-- ── Grant for new function ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.recalculate_subscription_discount(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.recalculate_subscription_discount(uuid) TO authenticated;

-- Backfill discount_pct for any existing active subscriptions
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.subscriptions WHERE status IN ('active','paused') LOOP
    PERFORM public.recalculate_subscription_discount(r.id);
  END LOOP;
END $$;
