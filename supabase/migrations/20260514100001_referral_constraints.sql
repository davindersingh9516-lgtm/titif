-- Prevent referral reward abuse:
-- 1. UNIQUE constraint so (referrer, referee) pair can only exist once
--    Note: referee_id already has a solo UNIQUE, this adds the pair constraint too
-- 2. Per-month cap per referrer via function check

-- Add UNIQUE constraint on (referrer_id, referee_id) if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.referrals'::regclass
      AND contype = 'u'
      AND conname = 'referrals_pair_unique'
  ) THEN
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_pair_unique UNIQUE (referrer_id, referee_id);
  END IF;
END $$;

-- Guard function: monthly cap check per referrer
CREATE OR REPLACE FUNCTION public.referral_monthly_cap_ok(
  p_referrer_id uuid,
  p_month_start date DEFAULT date_trunc('month', now())::date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) < coalesce(
    (SELECT (value->>'monthly_referral_cap')::int FROM app_settings WHERE key = 'features'),
    10
  )
  FROM referrals
  WHERE referrer_id = p_referrer_id
    AND status = 'rewarded'
    AND rewarded_at >= p_month_start;
$$;

REVOKE ALL ON FUNCTION public.referral_monthly_cap_ok(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.referral_monthly_cap_ok(uuid, date) TO authenticated, service_role;

-- Update reward_pending_referrals to check monthly cap
CREATE OR REPLACE FUNCTION public.reward_pending_referrals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r              record;
  v_count        int := 0;
  v_amount       numeric;
  v_ref_balance  numeric;
  v_rer_balance  numeric;
BEGIN
  SELECT coalesce((value->>'referral_reward_amount')::numeric,
                  coalesce((value->>'referral_bonus')::numeric, 50))
    INTO v_amount
  FROM app_settings WHERE key = 'features';

  v_amount := coalesce(v_amount, 50);

  FOR r IN
    SELECT rf.id, rf.referrer_id, rf.referee_id
    FROM public.referrals rf
    WHERE rf.status = 'pending'
      AND referral_monthly_cap_ok(rf.referrer_id)
      AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.user_id = rf.referee_id
          AND o.status = 'delivered'
        LIMIT 1
      )
    LIMIT 100
  LOOP
    -- Credit referrer
    SELECT balance INTO v_rer_balance
    FROM wallets WHERE user_id = r.referrer_id FOR UPDATE;

    IF v_rer_balance IS NOT NULL THEN
      UPDATE wallets SET balance = balance + v_amount, updated_at = now()
        WHERE user_id = r.referrer_id;
      INSERT INTO wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
        VALUES (r.referrer_id, 'adjustment', v_amount, v_rer_balance + v_amount,
                'Referral reward', r.id);
    END IF;

    -- Credit referee (welcome bonus)
    SELECT balance INTO v_ref_balance
    FROM wallets WHERE user_id = r.referee_id FOR UPDATE;

    IF v_ref_balance IS NOT NULL THEN
      UPDATE wallets SET balance = balance + v_amount, updated_at = now()
        WHERE user_id = r.referee_id;
      INSERT INTO wallet_transactions(user_id, type, amount, balance_after, description, reference_id)
        VALUES (r.referee_id, 'adjustment', v_amount, v_ref_balance + v_amount,
                'Referral welcome bonus', r.id);
    END IF;

    UPDATE public.referrals
      SET status = 'rewarded', reward_amount = v_amount, rewarded_at = now()
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.reward_pending_referrals() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reward_pending_referrals() TO service_role;
