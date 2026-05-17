-- Fix generate_subscription_orders to read meal prices from app_settings.pricing
-- instead of menu_items.price. This ensures admin's pricing settings are
-- actually used for billing — previously menu_items had stale seed prices (50/60/90)
-- regardless of what admin set in the settings panel.

CREATE OR REPLACE FUNCTION public.generate_subscription_orders(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_date             date;
  v_sub              RECORD;
  v_meal             public.meal_type;
  v_menu_name        text;
  v_menu_size        public.meal_size;
  v_menu_item_id     uuid;
  v_price            numeric;
  v_settings_pricing jsonb;
  v_balance          numeric;
  v_otp              text;
  v_order_id         uuid;
  v_created          int := 0;
  v_skip_exist       int := 0;
  v_skip_pause       int := 0;
  v_skip_wallet      int := 0;
  v_errors           int := 0;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_date := coalesce(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);

  -- Load pricing from admin settings once (fallback to legacy defaults if unset)
  SELECT value INTO v_settings_pricing
    FROM public.app_settings WHERE key = 'pricing';

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

        -- Find matching menu item for name/size (not price — price comes from settings)
        SELECT id, name, size INTO v_menu_item_id, v_menu_name, v_menu_size
          FROM public.menu_items
          WHERE meal_type = v_meal
            AND (
              (v_meal = 'breakfast' AND size = 'fixed')
              OR (v_meal <> 'breakfast' AND size = v_sub.size)
            )
            AND active = true
          ORDER BY created_at ASC
          LIMIT 1;

        IF v_menu_item_id IS NULL THEN
          v_errors := v_errors + 1;
          CONTINUE;
        END IF;

        -- Determine price from admin settings (with per-type fallbacks)
        IF v_meal = 'breakfast' THEN
          v_price := coalesce((v_settings_pricing->>'breakfast')::numeric, 50);
        ELSIF v_sub.size = 'mini' THEN
          v_price := coalesce((v_settings_pricing->>'mini')::numeric, 60);
        ELSE
          v_price := coalesce((v_settings_pricing->>'large')::numeric, 90);
        END IF;

        -- Apply loyalty discount if subscription has one
        IF v_sub.discount_pct > 0 THEN
          v_price := round(v_price * (1 - v_sub.discount_pct::numeric / 100));
        END IF;

        -- Check wallet balance
        SELECT balance INTO v_balance
          FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;

        IF v_balance IS NULL OR v_balance < v_price THEN
          v_skip_wallet := v_skip_wallet + 1;
          BEGIN
            PERFORM public.notify_user(
              v_sub.user_id, 'low_wallet',
              'Low wallet balance',
              'Your subscription order for ' || initcap(v_meal::text) || ' on ' || v_date::text || ' could not be placed. Please top up your wallet.',
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
          v_otp, '📅 Subscription order'
        ) RETURNING id INTO v_order_id;

        INSERT INTO public.order_items(order_id, name, size, price, qty)
          VALUES (v_order_id, v_menu_name, v_menu_size, v_price, 1);

        -- Debit wallet
        UPDATE public.wallets
          SET balance = balance - v_price, updated_at = now()
          WHERE user_id = v_sub.user_id;

        INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
          VALUES (v_sub.user_id, 'order_debit', -v_price, v_balance - v_price,
                  initcap(v_meal::text) || ' subscription order', v_order_id);

        INSERT INTO public.order_events(order_id, status, actor_id, note)
          VALUES (v_order_id, 'placed', v_uid, 'Auto-placed by subscription');

        BEGIN
          PERFORM public.notify_user(
            v_sub.user_id, 'order_confirmed',
            'Subscription order placed',
            'Your ' || initcap(v_meal::text) || ' subscription order for today has been placed. ₹' || v_price::text || ' debited.',
            '/app/orders',
            jsonb_build_object('order_id', v_order_id, 'meal', v_meal, 'total', v_price),
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
