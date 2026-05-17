-- Two fixes in one:
-- 1. Deploy notify_user (with all deps) so it actually exists.
-- 2. Wrap notify_user calls in place_order with EXCEPTION so a missing/broken
--    notify function never blocks an order from being placed.

-- ── notify_channel enum ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.notify_channel AS ENUM ('whatsapp','sms','push','in_app');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── notification_log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid,
  channel         public.notify_channel NOT NULL,
  template        text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'queued',
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  priority        smallint    NOT NULL DEFAULT 5,
  scheduled_for   timestamptz NOT NULL DEFAULT now(),
  attempts        int         NOT NULL DEFAULT 0,
  max_attempts    int         NOT NULL DEFAULT 5,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  to_phone        text
);

ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS priority        smallint    NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS scheduled_for   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempts        int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts    int         NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at         timestamptz,
  ADD COLUMN IF NOT EXISTS to_phone        text;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_log self read"    ON public.notification_log;
DROP POLICY IF EXISTS "notif_log admin manage" ON public.notification_log;
CREATE POLICY "notif_log self read"    ON public.notification_log FOR SELECT
  USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY "notif_log admin manage" ON public.notification_log FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ── notification_preferences ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id               uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  in_app                boolean     NOT NULL DEFAULT true,
  whatsapp              boolean     NOT NULL DEFAULT true,
  low_balance_threshold numeric     NOT NULL DEFAULT 100,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prefs self all" ON public.notification_preferences;
CREATE POLICY "prefs self all" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── notify_user ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id  uuid,
  p_type     text,
  p_title    text,
  p_body     text      DEFAULT NULL,
  p_link     text      DEFAULT NULL,
  p_payload  jsonb     DEFAULT '{}'::jsonb,
  p_channels text[]    DEFAULT ARRAY['in_app','whatsapp'],
  p_priority int       DEFAULT 5          -- int so literal 3/5 matches without cast
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pref  public.notification_preferences%rowtype;
  v_phone text;
  v_id    uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_pref FROM public.notification_preferences WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.notification_preferences(user_id) VALUES (p_user_id)
    RETURNING * INTO v_pref;
  END IF;

  IF 'in_app' = ANY(p_channels) AND v_pref.in_app THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, payload)
    VALUES (p_user_id, p_type, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb))
    RETURNING id INTO v_id;
  END IF;

  IF 'whatsapp' = ANY(p_channels) AND v_pref.whatsapp THEN
    SELECT phone INTO v_phone FROM public.profiles WHERE id = p_user_id;
    INSERT INTO public.notification_log(user_id, channel, template, payload, status, priority, to_phone)
    VALUES (p_user_id, 'whatsapp', p_type,
            coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('title', p_title, 'body', p_body, 'link', p_link),
            'queued', p_priority::smallint, v_phone);
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.notify_user(uuid,text,text,text,text,jsonb,text[],int) TO authenticated;

-- ── place_order — notify wrapped in EXCEPTION so a broken notify never blocks orders ──
CREATE OR REPLACE FUNCTION public.place_order(
  p_meal          meal_type,
  p_delivery_date date,
  p_window        delivery_window,
  p_address       text,
  p_lat           double precision,
  p_lng           double precision,
  p_items         jsonb,
  p_notes         text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid    := auth.uid();
  v_total    numeric := 0;
  v_balance  numeric;
  v_order_id uuid;
  v_otp      text;
  v_item     jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'cart_empty'; END IF;
  IF now() > public.cutoff_for(p_meal, p_delivery_date) THEN RAISE EXCEPTION 'cutoff_passed'; END IF;
  IF coalesce(length(trim(p_address)), 0) < 5 THEN RAISE EXCEPTION 'invalid_address'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_total := v_total + (v_item->>'price')::numeric * (v_item->>'qty')::int;
  END LOOP;

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_balance IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (v_uid, 0);
    v_balance := 0;
  END IF;
  IF v_balance < v_total THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  v_otp := lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.orders(
    user_id, meal_type, delivery_date, delivery_window, status,
    subtotal, total, address, lat, lng, delivery_otp, notes
  ) VALUES (
    v_uid, p_meal, p_delivery_date, p_window, 'placed',
    v_total, v_total, p_address, p_lat, p_lng, v_otp, p_notes
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items(order_id, name, size, price, qty)
  SELECT v_order_id, x->>'name', (x->>'size')::meal_size, (x->>'price')::numeric, (x->>'qty')::int
  FROM jsonb_array_elements(p_items) x;

  UPDATE public.wallets SET balance = balance - v_total, updated_at = now() WHERE user_id = v_uid;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  VALUES (v_uid, 'order_debit', -v_total, v_balance - v_total,
          initcap(p_meal::text) || ' order', v_order_id);

  INSERT INTO public.order_events(order_id, status, actor_id, note)
  VALUES (v_order_id, 'placed', v_uid, 'Order placed');

  -- Notifications: wrapped so a missing/broken notify never rolls back the order
  BEGIN
    PERFORM public.notify_user(
      v_uid, 'order_confirmed', 'Order confirmed',
      'Your ' || p_meal::text || ' order for ' || to_char(p_delivery_date, 'DD Mon') || ' is confirmed.',
      '/app/track/' || v_order_id::text,
      jsonb_build_object('order_id', v_order_id, 'meal', p_meal, 'total', v_total),
      ARRAY['in_app', 'whatsapp'], 3
    );

    IF (v_balance - v_total) < coalesce(
        (SELECT low_balance_threshold FROM public.notification_preferences WHERE user_id = v_uid), 100) THEN
      PERFORM public.notify_user(
        v_uid, 'low_balance', 'Wallet running low',
        'Your wallet balance is ₹' || (v_balance - v_total)::text || '. Recharge to keep ordering.',
        '/app/wallet', '{}'::jsonb, ARRAY['in_app', 'whatsapp'], 6
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- notification failure must never block order placement
  END;

  RETURN v_order_id;
END $$;
