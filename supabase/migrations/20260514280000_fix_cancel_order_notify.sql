-- cancel_order_with_refund calls notify_user without an exception guard.
-- If notify fails for any reason, the whole transaction (refund + status update) rolls back.
-- Wrap the notify call so a broken notification never blocks a refund.

CREATE OR REPLACE FUNCTION public.cancel_order_with_refund(
  p_order_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid    := auth.uid();
  v_order    public.orders%rowtype;
  v_balance  numeric;
  v_is_admin boolean := public.is_admin(v_uid);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.user_id <> v_uid AND NOT v_is_admin THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_order.status IN ('cancelled', 'delivered') THEN RETURN; END IF;
  IF NOT v_is_admin AND now() > public.cutoff_for(v_order.meal_type, v_order.delivery_date) THEN
    RAISE EXCEPTION 'cutoff_passed';
  END IF;

  -- Cancel order
  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_events(order_id, status, actor_id, note)
    VALUES (p_order_id, 'cancelled', v_uid, coalesce(p_reason, 'Cancelled'));

  -- Instant refund to wallet
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_order.user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (v_order.user_id, 0);
    v_balance := 0;
  END IF;

  UPDATE public.wallets
    SET balance = balance + v_order.total, updated_at = now()
    WHERE user_id = v_order.user_id;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
    VALUES (v_order.user_id, 'refund', v_order.total, v_balance + v_order.total,
            'Refund for cancelled order', p_order_id);

  -- Notify: wrapped so a broken notification never rolls back the refund
  BEGIN
    PERFORM public.notify_user(
      v_order.user_id, 'order_cancelled',
      'Order cancelled',
      'Your order was cancelled. ₹' || v_order.total::text || ' refunded to your wallet instantly.',
      '/app/wallet',
      jsonb_build_object('order_id', p_order_id, 'reason', p_reason, 'refund', v_order.total),
      ARRAY['in_app', 'whatsapp'], 3
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- notification failure must never block refund
  END;
END $$;
