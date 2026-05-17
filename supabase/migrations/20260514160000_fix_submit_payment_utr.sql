-- Redeploy submit_payment_utr (was missing from live DB → 404 on RPC call).
-- Also improve create_payment_request UPI deep-link encoding so merchant
-- name appears correctly in GPay / PhonePe / Paytm.

-- 1. Fix create_payment_request: use percent-encoding for pn field
CREATE OR REPLACE FUNCTION public.create_payment_request(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid    := auth.uid();
  v_id       uuid;
  v_settings jsonb;
  v_vpa      text;
  v_name     text;
  v_qr       text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_amount IS NULL OR p_amount < 10  THEN RAISE EXCEPTION 'min_amount_10';    END IF;
  IF p_amount > 50000                   THEN RAISE EXCEPTION 'max_amount_50000'; END IF;

  SELECT value INTO v_settings FROM public.app_settings WHERE key = 'payments';
  v_vpa  := COALESCE(NULLIF(TRIM(v_settings->>'upi_vpa'),  ''), 'tiffin@upi');
  v_name := COALESCE(NULLIF(TRIM(v_settings->>'merchant_name'), ''), 'Tiffin Kitchen');

  -- UPI deep-link: spaces → %20, & → %26 in name to avoid breaking query string
  v_qr := 'upi://pay?pa=' || v_vpa
       || '&pn=' || replace(replace(v_name, ' ', '%20'), '&', '%26')
       || '&am=' || p_amount::text
       || '&cu=INR'
       || '&tn=Tiffin%20Wallet%20Recharge';

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

-- 2. Redeploy submit_payment_utr
CREATE OR REPLACE FUNCTION public.submit_payment_utr(p_payment_id uuid, p_utr text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_status payment_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF COALESCE(LENGTH(TRIM(p_utr)), 0) < 4 THEN RAISE EXCEPTION 'invalid_utr'; END IF;

  SELECT user_id, status INTO v_owner, v_status
    FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payment_not_pending'; END IF;

  UPDATE public.payments
    SET utr_reference = TRIM(p_utr), updated_at = now()
    WHERE id = p_payment_id;

  PERFORM public.notify_user(
    v_uid, 'payment_submitted',
    'Payment submitted',
    'We received your UTR. Verification usually takes a few minutes.',
    '/app/wallet',
    jsonb_build_object('payment_id', p_payment_id, 'utr', p_utr),
    array['in_app'], 5
  );
END $$;
