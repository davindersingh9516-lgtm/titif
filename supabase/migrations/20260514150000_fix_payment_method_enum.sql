-- Fix: create_payment_request was inserting 'upi'::payment_method but the
-- enum only contains 'upi_qr', 'cash', 'admin_credit'. Cast corrected.

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
  v_vpa  := COALESCE(v_settings->>'upi_vpa',       'tiffin@upi');
  v_name := COALESCE(v_settings->>'merchant_name', 'Tiffin Kitchen');

  -- Standard UPI deep-link (works in GPay, PhonePe, Paytm, etc.)
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
