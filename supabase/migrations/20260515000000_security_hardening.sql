-- ============================================================
-- SECURITY HARDENING — Pre-launch audit fixes
-- Run after all previous migrations.
--
-- CRITICAL:
--   1.  place_order: server-side price validation (client price ignored)
--   2.  place_order: duplicate order guard (same user/meal/date)
--   3.  Drop "orders self insert" RLS — all inserts must go through place_order()
--   4.  Drop user self-insert on wallet_transactions
--   5.  profiles.phone UNIQUE constraint (prevent multi-wallet abuse)
--
-- MAJOR:
--   6.  create_payment_request: max 1 pending payment per user
--   7.  UTR uniqueness: one UTR can only be verified once (no double-credit)
--   8.  pause_subscription_day: add FOR UPDATE lock before wallet refund
--   9.  lock_orders_past_cutoff: admin-only (was callable by any authenticated user)
--   10. OTP: 6 digits instead of 4
--
-- MODERATE:
--   11. UTR minimum length raised to 8 (real UPI UTRs are 12 digits)
--   12. place_order: cap items at 20 (anti-DoS)
--   13. cancel_subscription: auto-cancel future PLACED orders and refund
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. place_order — server-side price lookup, duplicate guard
-- ════════════════════════════════════════════════════════════
-- Prices are now fetched from menu_items (cheapest active item matching
-- meal_type + size). Client-supplied price field is completely ignored.
-- Duplicate guard: an active order for the same user/meal/date is rejected.
CREATE OR REPLACE FUNCTION public.place_order(
  p_meal          meal_type,
  p_delivery_date date,
  p_window        delivery_window,
  p_address       text,
  p_lat           double precision,
  p_lng           double precision,
  p_items         jsonb,           -- [{name, size, qty}] — price field ignored
  p_notes         text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid    := auth.uid();
  v_total     numeric := 0;
  v_balance   numeric;
  v_order_id  uuid;
  v_otp       text;
  v_item      jsonb;
  v_db_price  numeric;
  v_item_size meal_size;
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

  -- ── Duplicate order guard ─────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE user_id        = v_uid
      AND delivery_date  = p_delivery_date
      AND meal_type      = p_meal
      AND status        <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'order_already_exists';
  END IF;

  -- ── Server-side price lookup (client price is IGNORED) ────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_size := CASE
      WHEN p_meal = 'breakfast' THEN 'fixed'::meal_size
      ELSE (v_item->>'size')::meal_size
    END;

    SELECT price INTO v_db_price
      FROM public.menu_items
      WHERE meal_type = p_meal
        AND size      = v_item_size
        AND active    = true
      ORDER BY price ASC
      LIMIT 1;

    IF v_db_price IS NULL THEN
      RAISE EXCEPTION 'menu_item_not_found';
    END IF;

    v_total := v_total + v_db_price * (v_item->>'qty')::int;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'invalid_total'; END IF;

  -- ── Wallet lock + balance check ───────────────────────────
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_balance IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (v_uid, 0);
    v_balance := 0;
  END IF;
  IF v_balance < v_total THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  -- ── 6-digit OTP (was 4) ───────────────────────────────────
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
         (SELECT price FROM public.menu_items
           WHERE meal_type = p_meal
             AND size = CASE WHEN p_meal = 'breakfast' THEN 'fixed'::meal_size ELSE (x->>'size')::meal_size END
             AND active = true ORDER BY price ASC LIMIT 1),
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


-- ════════════════════════════════════════════════════════════
-- 2. Drop "orders self insert" RLS — only place_order() may insert
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "orders self insert" ON public.orders;
-- Admin may still insert directly (for back-office corrections)
DO $$ BEGIN
  CREATE POLICY "orders admin insert" ON public.orders FOR INSERT
    WITH CHECK (public.is_admin(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- 3. wallet_transactions — remove user self-insert
--    Users were allowed to INSERT their own tx rows directly (data pollution)
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "wtx admin insert" ON public.wallet_transactions;
DO $$ BEGIN
  CREATE POLICY "wtx admin insert" ON public.wallet_transactions FOR INSERT
    WITH CHECK (public.is_admin(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- 4. order_items — restrict direct insert to admins only
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "items self insert" ON public.order_items;
DO $$ BEGIN
  CREATE POLICY "items admin insert" ON public.order_items FOR INSERT
    WITH CHECK (public.is_admin(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- 5. profiles.phone — UNIQUE constraint (one wallet per phone)
-- ════════════════════════════════════════════════════════════
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_phone_unique UNIQUE (phone);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- 6. create_payment_request — max 1 pending per user
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_payment_request(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_id       uuid;
  v_settings jsonb;
  v_vpa      text;
  v_name     text;
  v_qr       text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_amount IS NULL OR p_amount < 10  THEN RAISE EXCEPTION 'min_amount_10';    END IF;
  IF p_amount > 50000                   THEN RAISE EXCEPTION 'max_amount_50000'; END IF;

  -- Rate limit: no more than 1 pending payment at a time
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE user_id = v_uid AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'pending_payment_exists';
  END IF;

  SELECT value INTO v_settings FROM public.app_settings WHERE key = 'payments';
  v_vpa  := COALESCE(v_settings->>'upi_vpa',       'tiffin@upi');
  v_name := COALESCE(v_settings->>'merchant_name', 'Tiffin Kitchen');

  v_qr := 'upi://pay?pa=' || v_vpa
       || '&pn=' || replace(v_name, ' ', '%20')
       || '&am=' || p_amount::text
       || '&cu=INR'
       || '&tn=Tiffin%20wallet%20topup';

  INSERT INTO public.payments(user_id, amount, method, status, qr_payload)
  VALUES (v_uid, p_amount, 'upi_qr'::payment_method, 'pending'::payment_status, v_qr)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'payment_id',    v_id,
    'amount',        p_amount,
    'qr_payload',    v_qr,
    'vpa',           v_vpa,
    'merchant_name', v_name
  );
END $$;


-- ════════════════════════════════════════════════════════════
-- 7. UTR uniqueness — one UTR can only be verified once
--    Prevents the same UTR being submitted for multiple payments
--    and admin accidentally crediting wallet twice.
-- ════════════════════════════════════════════════════════════

-- Raise minimum UTR length to 8 (real UPI UTR = 12 digits)
CREATE OR REPLACE FUNCTION public.submit_payment_utr(p_payment_id uuid, p_utr text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_status payment_status;
  v_utr_clean text := upper(trim(p_utr));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF COALESCE(LENGTH(v_utr_clean), 0) < 8 THEN RAISE EXCEPTION 'invalid_utr'; END IF;

  SELECT user_id, status INTO v_owner, v_status
    FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_owner <> v_uid  THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payment_not_pending'; END IF;

  -- Check this UTR hasn't been successfully verified before (double-credit guard)
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE utr_reference = v_utr_clean
      AND status = 'success'
      AND id <> p_payment_id
  ) THEN
    RAISE EXCEPTION 'utr_already_used';
  END IF;

  UPDATE public.payments
    SET utr_reference = v_utr_clean, updated_at = now()
    WHERE id = p_payment_id;

  BEGIN
    PERFORM public.notify_user(
      v_uid, 'payment_submitted',
      'Payment submitted',
      'We received your UTR. Verification usually takes a few minutes.',
      '/app/wallet',
      jsonb_build_object('payment_id', p_payment_id, 'utr', v_utr_clean),
      ARRAY['in_app'], 5
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;


-- admin_verify_payment: check UTR hasn't been credited to another account
CREATE OR REPLACE FUNCTION public.admin_verify_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_amount  numeric;
  v_status  payment_status;
  v_utr     text;
  v_balance numeric;
BEGIN
  IF NOT is_admin(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT user_id, amount, status, utr_reference
    INTO v_owner, v_amount, v_status, v_utr
    FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_status = 'success' THEN RETURN; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'invalid_status'; END IF;

  -- UTR must be submitted
  IF v_utr IS NULL OR length(trim(v_utr)) < 8 THEN
    RAISE EXCEPTION 'utr_not_submitted';
  END IF;

  -- Guard against verifying same UTR twice across different payment rows
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE utr_reference = v_utr
      AND status        = 'success'
      AND id           <> p_payment_id
  ) THEN
    RAISE EXCEPTION 'utr_already_verified_for_another_payment';
  END IF;

  INSERT INTO public.wallets(user_id, balance)
    VALUES (v_owner, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
    SET balance = balance + v_amount, updated_at = now()
    WHERE user_id = v_owner
    RETURNING balance INTO v_balance;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
    VALUES (v_owner, 'topup', v_amount, v_balance, 'Wallet top-up (UPI verified)', p_payment_id);

  UPDATE public.payments
    SET status      = 'success'::payment_status,
        verified_at = now(),
        verified_by = v_uid,
        updated_at  = now()
    WHERE id = p_payment_id;

  INSERT INTO public.audit_log(actor_id, action, target, meta)
    VALUES (v_uid, 'payment.verify', p_payment_id::text,
            jsonb_build_object('user_id', v_owner, 'amount', v_amount, 'utr', v_utr));

  BEGIN
    PERFORM public.notify_user(
      v_owner, 'wallet_credited',
      'Wallet credited',
      '₹' || v_amount::text || ' added to your wallet.',
      '/app/wallet',
      jsonb_build_object('payment_id', p_payment_id, 'amount', v_amount, 'balance', v_balance),
      ARRAY['in_app', 'whatsapp'], 4
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;


-- ════════════════════════════════════════════════════════════
-- 8. pause_subscription_day — add FOR UPDATE lock before wallet refund
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pause_subscription_day(
  p_sub_id    uuid,
  p_date      date,
  p_meal_type public.meal_type
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_sub     public.subscriptions%rowtype;
  v_oid     uuid;
  v_refund  numeric;
  v_balance numeric;
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

  -- Find existing active order for this day/meal
  SELECT id, total INTO v_oid, v_refund
    FROM public.orders
    WHERE user_id     = v_sub.user_id
      AND delivery_date = p_date
      AND meal_type   = p_meal_type
      AND status NOT IN ('cancelled', 'delivered')
    LIMIT 1;

  IF v_oid IS NOT NULL THEN
    UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_oid;
    INSERT INTO public.order_events(order_id, status, actor_id, note)
      VALUES (v_oid, 'cancelled', v_uid, 'Subscription day paused');

    -- Lock wallet row before update (prevents race condition)
    SELECT balance INTO v_balance
      FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;
    IF v_balance IS NULL THEN v_balance := 0; END IF;

    UPDATE public.wallets
      SET balance = balance + v_refund, updated_at = now()
      WHERE user_id = v_sub.user_id;

    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
      VALUES (v_sub.user_id, 'refund', v_refund, v_balance + v_refund,
              'Subscription pause refund', v_oid);

    BEGIN
      PERFORM public.notify_user(
        v_sub.user_id, 'order_cancelled',
        'Subscription paused',
        '₹' || v_refund::text || ' refunded — ' || initcap(p_meal_type::text) || ' paused on ' || to_char(p_date, 'DD Mon'),
        '/app/subscriptions',
        jsonb_build_object('date', p_date, 'meal', p_meal_type, 'refund', v_refund),
        ARRAY['in_app'], 5
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Recalculate discount
  PERFORM public.recalculate_subscription_discount(p_sub_id);
END $$;


-- ════════════════════════════════════════════════════════════
-- 9. cancel_subscription — also cancel & refund future PLACED orders
-- ════════════════════════════════════════════════════════════
-- Must DROP first because return type changes void → jsonb
DROP FUNCTION IF EXISTS public.cancel_subscription(uuid);
CREATE OR REPLACE FUNCTION public.cancel_subscription(p_sub_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_sub        public.subscriptions%rowtype;
  v_ord        RECORD;
  v_balance    numeric;
  v_refund_sum numeric := 0;
  v_cancel_cnt int     := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_sub_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  IF v_sub.user_id <> v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Cancel the subscription
  UPDATE public.subscriptions
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_sub_id;

  -- Cancel and refund all future placed orders from this subscription period
  FOR v_ord IN
    SELECT id, total FROM public.orders
    WHERE user_id     = v_sub.user_id
      AND delivery_date > (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND delivery_date BETWEEN v_sub.start_date AND v_sub.end_date
      AND status NOT IN ('cancelled', 'delivered', 'out_for_delivery')
  LOOP
    UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_ord.id;
    INSERT INTO public.order_events(order_id, status, actor_id, note)
      VALUES (v_ord.id, 'cancelled', v_uid, 'Subscription cancelled');
    v_refund_sum := v_refund_sum + v_ord.total;
    v_cancel_cnt := v_cancel_cnt + 1;
  END LOOP;

  -- Bulk refund if any orders were cancelled
  IF v_refund_sum > 0 THEN
    SELECT balance INTO v_balance
      FROM public.wallets WHERE user_id = v_sub.user_id FOR UPDATE;
    IF v_balance IS NULL THEN v_balance := 0; END IF;

    UPDATE public.wallets
      SET balance = balance + v_refund_sum, updated_at = now()
      WHERE user_id = v_sub.user_id;

    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
      VALUES (v_sub.user_id, 'refund', v_refund_sum, v_balance + v_refund_sum,
              'Subscription cancelled — ' || v_cancel_cnt || ' order(s) refunded', p_sub_id);
  END IF;

  BEGIN
    PERFORM public.notify_user(
      v_sub.user_id, 'subscription_cancelled',
      'Subscription cancelled',
      CASE WHEN v_refund_sum > 0
        THEN '₹' || v_refund_sum::text || ' refunded for ' || v_cancel_cnt || ' upcoming order(s).'
        ELSE 'Your subscription has been cancelled.'
      END,
      '/app/subscriptions',
      jsonb_build_object('sub_id', p_sub_id, 'refund', v_refund_sum, 'cancelled_orders', v_cancel_cnt),
      ARRAY['in_app'], 4
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'cancelled_orders', v_cancel_cnt,
    'refund_total',     v_refund_sum
  );
END $$;


-- ════════════════════════════════════════════════════════════
-- 10. lock_orders_past_cutoff — admin/service_role only
--     (was callable by any authenticated user)
-- ════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.lock_orders_past_cutoff() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.lock_orders_past_cutoff() TO service_role;


-- ════════════════════════════════════════════════════════════
-- 11. Re-grant everything correctly
-- ════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.place_order(meal_type, date, delivery_window, text, double precision, double precision, jsonb, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.place_order(meal_type, date, delivery_window, text, double precision, double precision, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_payment_request(numeric)   FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.create_payment_request(numeric)   TO authenticated;

REVOKE ALL ON FUNCTION public.submit_payment_utr(uuid, text)   FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.submit_payment_utr(uuid, text)   TO authenticated;

REVOKE ALL ON FUNCTION public.admin_verify_payment(uuid)        FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_verify_payment(uuid)        TO authenticated;

REVOKE ALL ON FUNCTION public.pause_subscription_day(uuid, date, public.meal_type) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.pause_subscription_day(uuid, date, public.meal_type) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_subscription(uuid)         FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_subscription(uuid)         TO authenticated;
