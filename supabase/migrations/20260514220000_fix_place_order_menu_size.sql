-- place_order was casting to 'menu_size' which doesn't exist.
-- The correct enum name is 'meal_size' ('mini' | 'large' | 'fixed').

CREATE OR REPLACE FUNCTION public.place_order(
  p_meal meal_type, p_delivery_date date, p_window delivery_window,
  p_address text, p_lat double precision, p_lng double precision,
  p_items jsonb, p_notes text DEFAULT NULL
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

  -- Fixed: was ::menu_size (doesn't exist), correct type is ::meal_size
  INSERT INTO public.order_items(order_id, name, size, price, qty)
  SELECT v_order_id, x->>'name', (x->>'size')::meal_size, (x->>'price')::numeric, (x->>'qty')::int
  FROM jsonb_array_elements(p_items) x;

  UPDATE public.wallets SET balance = balance - v_total, updated_at = now() WHERE user_id = v_uid;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
  VALUES (v_uid, 'order_debit', -v_total, v_balance - v_total,
          (initcap(p_meal::text) || ' order'), v_order_id);

  INSERT INTO public.order_events(order_id, status, actor_id, note)
  VALUES (v_order_id, 'placed', v_uid, 'Order placed');

  PERFORM public.notify_user(
    v_uid, 'order_confirmed',
    'Order confirmed',
    'Your ' || p_meal::text || ' order for ' || to_char(p_delivery_date, 'DD Mon') || ' is confirmed.',
    '/app/track/' || v_order_id::text,
    jsonb_build_object('order_id', v_order_id, 'meal', p_meal, 'total', v_total),
    array['in_app', 'whatsapp'], 3
  );

  IF (v_balance - v_total) < coalesce(
      (SELECT low_balance_threshold FROM public.notification_preferences WHERE user_id = v_uid), 100) THEN
    PERFORM public.notify_user(
      v_uid, 'low_balance',
      'Wallet running low',
      'Your wallet balance is ₹' || (v_balance - v_total)::text || '. Recharge to keep ordering.',
      '/app/wallet', '{}'::jsonb, array['in_app', 'whatsapp'], 6
    );
  END IF;

  RETURN v_order_id;
END $$;
