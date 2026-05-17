-- wallet_tx_type enum is: topup | order_debit | refund | adjustment
-- admin_verify_payment and admin_adjust_wallet were using 'recharge' which doesn't exist.

CREATE OR REPLACE FUNCTION public.admin_verify_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_amount numeric;
  v_status payment_status;
  v_balance numeric;
BEGIN
  IF NOT is_admin(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT user_id, amount, status INTO v_owner, v_amount, v_status
    FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_status = 'success'  THEN RETURN; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'invalid_status'; END IF;

  INSERT INTO public.wallets(user_id, balance)
    VALUES (v_owner, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
    SET balance = balance + v_amount, updated_at = now()
    WHERE user_id = v_owner
    RETURNING balance INTO v_balance;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
    VALUES (v_owner, 'topup', v_amount, v_balance, 'Wallet top-up (UPI)', p_payment_id);

  UPDATE public.payments
    SET status      = 'success'::payment_status,
        verified_at = now(),
        verified_by = v_uid,
        updated_at  = now()
    WHERE id = p_payment_id;

  INSERT INTO public.audit_log(actor_id, action, target, meta)
    VALUES (v_uid, 'payment.verify', p_payment_id::text,
            jsonb_build_object('user_id', v_owner, 'amount', v_amount));
END $$;

-- Also fix admin_adjust_wallet which had the same bug
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(p_user_id uuid, p_delta numeric, p_reason text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_balance numeric;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'invalid_delta'; END IF;
  IF COALESCE(LENGTH(TRIM(p_reason)), 0) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF (v_balance + p_delta) < 0 THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  UPDATE public.wallets
    SET balance = balance + p_delta, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_balance;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description)
    VALUES (
      p_user_id,
      CASE WHEN p_delta > 0 THEN 'topup' ELSE 'adjustment' END,
      p_delta, v_balance,
      'Admin adjustment: ' || p_reason
    );

  INSERT INTO public.audit_log(actor_id, action, target, meta)
    VALUES (auth.uid(), 'wallet.adjust', p_user_id::text,
            jsonb_build_object('delta', p_delta, 'reason', p_reason, 'balance', v_balance));

  RETURN v_balance;
END $$;
