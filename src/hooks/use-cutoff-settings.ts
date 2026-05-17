import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { istMidnight, type MealType } from "@/lib/meals";

export type CutoffSettings = {
  breakfast_prev_night_hour: number; // IST hour (0-23) on the night before delivery
  lunch_hour: number;
  dinner_hour: number;
};

const DEFAULTS: CutoffSettings = {
  breakfast_prev_night_hour: 23,
  lunch_hour: 10,
  dinner_hour: 15,
};

export function useCutoffSettings(): CutoffSettings {
  const { data } = useQuery({
    queryKey: ["cutoff-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "cutoffs")
        .maybeSingle();
      return data?.value as Partial<CutoffSettings> | null;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { ...DEFAULTS, ...data };
}

/**
 * IST-aware cutoff check using server-configurable hours.
 * Uses UTC offset arithmetic — safe regardless of device timezone.
 */
export function isBeforeCutoffDynamic(
  meal: MealType,
  deliveryDate: Date,
  settings: CutoffSettings,
  now = new Date(),
): boolean {
  const mid = istMidnight(deliveryDate).getTime();

  let cutoff: number;
  if (meal === "breakfast") {
    // previous IST night at settings.breakfast_prev_night_hour:59
    cutoff = mid - 86_400_000 + settings.breakfast_prev_night_hour * 3_600_000 + 59 * 60_000;
  } else if (meal === "lunch") {
    cutoff = mid + settings.lunch_hour * 3_600_000;
  } else {
    cutoff = mid + settings.dinner_hour * 3_600_000;
  }

  return now.getTime() <= cutoff;
}
