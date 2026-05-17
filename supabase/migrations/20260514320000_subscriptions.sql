-- ============================================================
-- Subscription Module — pay-as-you-go daily meal subscriptions
--
-- Model:
--   A subscription = "auto-place my regular meal(s) every day from my wallet."
--   No upfront charge. Each generated order debits wallet normally.
--   Users can pause/resume any individual day before that meal's cutoff.
--   Admin generates orders each morning via generate_subscription_orders().
-- ============================================================


-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE public.subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meal_types      public.meal_type[] NOT NULL CHECK (cardinality(meal_types) > 0),
  size            public.meal_size NOT NULL DEFAULT 'mini',
  delivery_window public.delivery_window NOT NULL DEFAULT 'round_1',
  address         text NOT NULL,
  lat             double precision,
  lng             double precision,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','cancelled')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sub_dates_valid CHECK (end_date >= start_date)
);
CREATE INDEX ON public.subscriptions (user_id, status);
CREATE INDEX ON public.subscriptions (start_date, end_date, status);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Sparse day-level pauses: one row = that meal is skipped on that day
CREATE TABLE public.subscription_pauses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pause_date      date NOT NULL,
  meal_type       public.meal_type NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, pause_date, meal_type)
);
CREATE INDEX ON public.subscription_pauses (user_id, pause_date);
CREATE INDEX ON public.subscription_pauses (subscription_id, pause_date);
ALTER TABLE public.subscription_pauses ENABLE ROW LEVEL SECURITY;


-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- subscriptions
CREATE POLICY "sub self read"   ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "sub self insert" ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sub self update" ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- subscription_pauses
CREATE POLICY "pause self read"   ON public.subscription_pauses FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "pause self insert" ON public.subscription_pauses FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pause self delete" ON public.subscription_pauses FOR DELETE
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
-- Admin can insert pauses on behalf of users
CREATE POLICY "pause admin insert" ON public.subscription_pauses FOR INSERT
  WITH CHECK (public.is_admin(auth.uid()));


-- ── Trigger: updated_at ───────────────────────────────────────────────────────
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── Function 1: create_subscription ─────────────────────────────────────────
-- Creates (or replaces) a user's active subscription.
-- Cancels any existing active/paused subscription first.
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
  v_uid   uuid := auth.uid();
  v_start date;
  v_end   date;
  v_sub_id uuid;
  v_addr  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_meal_types IS NULL OR cardinality(p_meal_types) = 0 THEN
    RAISE EXCEPTION 'select_at_least_one_meal';
  END IF;

  -- Determine address: use provided, else fall back to profile address
  v_addr := p_address;
  IF v_addr IS NULL OR length(trim(v_addr)) < 5 THEN
    SELECT address INTO v_addr FROM public.profiles WHERE id = v_uid;
  END IF;
  IF v_addr IS NULL OR length(trim(v_addr)) < 5 THEN
    RAISE EXCEPTION 'invalid_address';
  END IF;

  -- Start date defaults to tomorrow (safest — today might have passed cutoffs)
  v_start := coalesce(p_start_date, (now() AT TIME ZONE 'Asia/Kolkata')::date + 1);
  v_end   := v_start + 29;  -- 30-day cycle (start inclusive, end inclusive)

  -- Cancel existing active/paused subscription
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

  RETURN v_sub_id;
END $$;


-- ── Function 2: pause_subscription_day ───────────────────────────────────────
-- User pauses a specific meal on a specific date.
-- If an order was already generated, it is cancelled + refunded.
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
  -- Enforce cutoff (non-admin)
  IF NOT public.is_admin(v_uid) AND now() > public.cutoff_for(p_meal_type, p_date) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  -- Insert pause record (ignore if already paused)
  INSERT INTO public.subscription_pauses(subscription_id, user_id, pause_date, meal_type)
    VALUES (p_sub_id, v_sub.user_id, p_date, p_meal_type)
    ON CONFLICT DO NOTHING;

  -- If an order already exists for this day/meal, cancel + refund it
  SELECT id INTO v_oid
    FROM public.orders
    WHERE user_id = v_sub.user_id
      AND delivery_date = p_date
      AND meal_type = p_meal_type
      AND status NOT IN ('cancelled', 'delivered')
    LIMIT 1;

  IF v_oid IS NOT NULL THEN
    -- Use admin context to bypass cutoff check in cancel function
    UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_oid;
    INSERT INTO public.order_events(order_id, status, actor_id, note)
      VALUES (v_oid, 'cancelled', v_uid, 'Subscription day paused');

    -- Refund wallet
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
END $$;


-- ── Function 3: resume_subscription_day ──────────────────────────────────────
-- Removes a pause for a specific day (order will be generated next cycle).
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
END $$;


-- ── Function 4: cancel_subscription ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_subscription(p_sub_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.subscriptions
    SET status = 'cancelled', updated_at = now()
  WHERE id = p_sub_id
    AND (user_id = v_uid OR public.is_admin(v_uid));
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found_or_forbidden'; END IF;
END $$;


-- ── Function 5: generate_subscription_orders ─────────────────────────────────
-- Admin: auto-place orders for all active subscriptions on a given date.
-- Returns JSONB summary: {created, skipped_existing, skipped_paused, skipped_low_wallet, errors}
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
  v_otp           text;
  v_order_id      uuid;
  v_created       int := 0;
  v_skip_exist    int := 0;
  v_skip_pause    int := 0;
  v_skip_wallet   int := 0;
  v_errors        int := 0;
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

        -- Skip if order already exists (active)
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

        -- Check wallet balance
        SELECT balance INTO v_balance
          FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;

        IF v_balance IS NULL OR v_balance < v_menu.price THEN
          v_skip_wallet := v_skip_wallet + 1;
          -- Notify user their wallet is low (best-effort)
          BEGIN
            PERFORM public.notify_user(
              v_sub.user_id, 'low_wallet',
              'Low wallet balance',
              'Your subscription order for ' || initcap(v_meal::text) || ' on ' || v_date::text || ' could not be placed. Please top up your wallet.',
              '/app/wallet',
              jsonb_build_object('meal', v_meal, 'date', v_date, 'required', v_menu.price, 'balance', v_balance),
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
          v_menu.price, v_menu.price,
          v_sub.address, v_sub.lat, v_sub.lng,
          v_otp, '📅 Subscription order'
        ) RETURNING id INTO v_order_id;

        INSERT INTO public.order_items(order_id, name, size, price, qty)
          VALUES (v_order_id, v_menu.name, v_menu.size, v_menu.price, 1);

        -- Debit wallet
        UPDATE public.wallets
          SET balance = balance - v_menu.price, updated_at = now()
          WHERE user_id = v_sub.user_id;

        INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
          VALUES (v_sub.user_id, 'order_debit', -v_menu.price, v_balance - v_menu.price,
                  initcap(v_meal::text) || ' subscription order', v_order_id);

        INSERT INTO public.order_events(order_id, status, actor_id, note)
          VALUES (v_order_id, 'placed', v_uid, 'Auto-placed by subscription');

        -- Notify user (best-effort)
        BEGIN
          PERFORM public.notify_user(
            v_sub.user_id, 'order_confirmed',
            'Subscription order placed',
            'Your ' || initcap(v_meal::text) || ' subscription order for today has been placed. ₹' || v_menu.price::text || ' debited.',
            '/app/orders',
            jsonb_build_object('order_id', v_order_id, 'meal', v_meal, 'total', v_menu.price),
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
    'date',             v_date,
    'created',          v_created,
    'skipped_existing', v_skip_exist,
    'skipped_paused',   v_skip_pause,
    'skipped_low_wallet', v_skip_wallet,
    'errors',           v_errors
  );
END $$;


-- ── Function 6: admin_subscription_kpis ──────────────────────────────────────
-- Returns subscriber counts by meal for a given date (excluding pauses).
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
    'total_active',       (SELECT count(DISTINCT id) FROM active_subs),
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


-- ── Function 7: admin_subscriber_list ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_subscriber_list()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE AS $$
DECLARE
  v_uid uuid := auth.uid();
  v     jsonb;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id',           s.id,
      'user_id',      s.user_id,
      'full_name',    p.full_name,
      'phone',        p.phone,
      'meal_types',   s.meal_types,
      'size',         s.size,
      'window',       s.delivery_window,
      'start_date',   s.start_date,
      'end_date',     s.end_date,
      'status',       s.status,
      'pause_count',  (SELECT count(*) FROM public.subscription_pauses sp WHERE sp.subscription_id = s.id),
      'created_at',   s.created_at
    ) ORDER BY s.created_at DESC
  ), '[]'::jsonb) INTO v
  FROM public.subscriptions s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.status IN ('active', 'paused');

  RETURN v;
END $$;


-- ── Permissions ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_subscription(public.meal_type[], public.meal_size, public.delivery_window, text, double precision, double precision, date, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.pause_subscription_day(uuid, date, public.meal_type) FROM public, anon;
REVOKE ALL ON FUNCTION public.resume_subscription_day(uuid, date, public.meal_type) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_subscription(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.generate_subscription_orders(date) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_subscription_kpis(date) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_subscriber_list() FROM public, anon;

GRANT EXECUTE ON FUNCTION public.create_subscription(public.meal_type[], public.meal_size, public.delivery_window, text, double precision, double precision, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_subscription_day(uuid, date, public.meal_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_subscription_day(uuid, date, public.meal_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_subscription(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_subscription_orders(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_subscription_kpis(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_subscriber_list() TO authenticated;


-- ── Realtime ─────────────────────────────────────────────────────────────────

ALTER TABLE public.subscriptions       REPLICA IDENTITY FULL;
ALTER TABLE public.subscription_pauses REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_pauses;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
