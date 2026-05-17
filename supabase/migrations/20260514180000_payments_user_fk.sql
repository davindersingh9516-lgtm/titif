-- payments.user_id had no FK, so PostgREST couldn't resolve the profiles join
-- in admin.payments.tsx — query was returning empty array silently.

ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Also redeploy submit_payment_utr without the missing notify_user call
-- so UTR submission works.
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
  IF v_owner <> v_uid  THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payment_not_pending'; END IF;

  UPDATE public.payments
    SET utr_reference = TRIM(p_utr), updated_at = now()
    WHERE id = p_payment_id;
END $$;
