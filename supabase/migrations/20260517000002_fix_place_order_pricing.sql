-- Fix place_order to read prices from app_settings.pricing instead of
-- menu_items.price. Security is preserved — client-supplied price is still
-- ignored; price comes from the server-side admin settings, not menu_items.

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
  v_uid              uuid    := auth.uid();
  v_total            numeric := 0;
  v_balance          numeric;
  v_order_id         uuid;
  v_otp              text;
  v_item             jsonb;
  v_item_size        meal_size;
  v_item_name        text;
  v_item_qty         int;
  v_db_price         numeric;
  v_settings_pricing jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'cart_empty';
  END IF;
  IF jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION 'too_many_items';
  END IF;
  IF now() > public.cutoff_for(p_meal, p_delivery_date) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;
  IF coalesce(length(trim(p_address)), 0) < 5 THEN
    RAISE EXCEPTION 'invalid_address';
  END IF;

  -- Duplicate order guard
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE user_id       = v_uid
      AND delivery_date = p_delivery_date
      AND meal_type     = p_meal
      AND status       <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'order_already_exists';
  END IF;

  -- Load admin pricing once (server-side — client price field ignored)
  SELECT value INTO v_settings_pricing
    FROM public.app_settings WHERE key = 'pricing';

  -- Compute total using admin settings price (not client-supplied, not menu_items.price)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_size := CASE
      WHEN p_meal = 'breakfast' THEN 'fixed'::meal_size
      ELSE (v_item->>'size')::meal_size
    END;

    v_db_price := CASE
      WHEN p_meal = 'breakfast'       THEN coalesce((v_settings_pricing->>'breakfast')::numeric, 50)
      WHEN v_item_size = 'mini'       THEN coalesce((v_settings_pricing->>'mini')::numeric, 60)
      ELSE                                 coalesce((v_settings_pricing->>'large')::numeric, 90)
    END;

    v_total := v_total + v_db_price * (v_item->>'qty')::int;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'invalid_total'; END IF;

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_balance IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (v_uid, 0);
    v_balance := 0;
  END IF;
  IF v_balance < v_total THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  v_otp := lpad((floor(random() * 1000000))::text, 6, '0');

  INSERT INTO public.orders(
    user_id, meal_type, delivery_date, delivery_window, status,
    subtotal, total, address, lat, lng, delivery_otp, notes
  ) VALUES (
    v_uid, p_meal, p_delivery_date, p_window, 'placed',
    v_total, v_total, p_address, p_lat, p_lng, v_otp, p_notes
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items(order_id, name, size, price, qty)
  SELECT v_order_id,
         coalesce(x->>'name', initcap(p_meal::text)),
         CASE WHEN p_meal = 'breakfast' THEN 'fixed'::meal_size ELSE (x->>'size')::meal_size END,
         CASE
           WHEN p_meal = 'breakfast'                                      THEN coalesce((v_settings_pricing->>'breakfast')::numeric, 50)
           WHEN (x->>'size') = 'mini'                                     THEN coalesce((v_settings_pricing->>'mini')::numeric, 60)
           ELSE                                                                 coalesce((v_settings_pricing->>'large')::numeric, 90)
         END,
         (x->>'qty')::int
  FROM jsonb_array_elements(p_items) x;

  UPDATE public.wallets SET balance = balance - v_total, updated_at = now() WHERE user_id = v_uid;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  VALUES (v_uid, 'order_debit', -v_total, v_balance - v_total,
          initcap(p_meal::text) || ' order', v_order_id);

  INSERT INTO public.order_events(order_id, status, actor_id, note)
  VALUES (v_order_id, 'placed', v_uid, 'Order placed');

  BEGIN
    PERFORM public.notify_user(
      v_uid, 'order_confirmed', 'Order confirmed',
      'Your ' || p_meal::text || ' order for ' || to_char(p_delivery_date, 'DD Mon') || ' is confirmed. ₹' || v_total::text || ' debited.',
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
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_order_id;
END $$;
