-- Feature flags stored in app_settings under key 'features'.
-- Super admin can toggle via super.settings page.
-- Frontend reads via useFeatureFlags hook.

INSERT INTO public.app_settings (key, value)
VALUES (
  'features',
  '{
    "referrals": true,
    "loyalty": true,
    "support": true,
    "wallet_topup": true,
    "rider_tracking": true,
    "push_notifications": true,
    "referral_reward_amount": 50,
    "monthly_referral_cap": 10
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE
  SET value = app_settings.value || EXCLUDED.value;
