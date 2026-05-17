import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FeatureFlags = {
  referrals: boolean;
  loyalty: boolean;
  support: boolean;
  wallet_topup: boolean;
  rider_tracking: boolean;
  push_notifications: boolean;
  referral_reward_amount: number;
  monthly_referral_cap: number;
};

const DEFAULTS: FeatureFlags = {
  referrals: true,
  loyalty: true,
  support: true,
  wallet_topup: true,
  rider_tracking: true,
  push_notifications: true,
  referral_reward_amount: 50,
  monthly_referral_cap: 10,
};

export function useFeatureFlags(): FeatureFlags {
  const { data } = useQuery({
    queryKey: ["feature-flags"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "features")
        .maybeSingle();
      return data?.value as Partial<FeatureFlags> | null;
    },
    staleTime: 5 * 60 * 1000, // refresh every 5 min
  });

  return { ...DEFAULTS, ...data };
}
