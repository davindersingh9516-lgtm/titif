import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Pricing = { breakfast: number; mini: number; large: number };

const DEFAULT: Pricing = { breakfast: 70, mini: 75, large: 120 };

export function usePricing(): Pricing {
  const { data } = useQuery({
    queryKey: ["app_settings", "pricing"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "pricing")
        .maybeSingle();
      return data?.value as Pricing | null;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { ...DEFAULT, ...(data ?? {}) };
}
