import { useState, useEffect, useCallback } from "react";
import { isBeforeCutoff, nextDeliveryDate, istMidnight, type MealType } from "@/lib/meals";
import { subscribeTick } from "@/lib/shared-ticker";
import { Timer } from "lucide-react";

function computeCutoff(meal: MealType, deliveryDate: Date): Date {
  const mid = istMidnight(deliveryDate).getTime();
  if (meal === "breakfast") return new Date(mid -  60_000);
  if (meal === "lunch")     return new Date(mid + 36_000_000);
  return                          new Date(mid + 54_000_000);
}

function fmt(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Returns ms remaining and formatted string, or null when closed.
 *  All instances share ONE setInterval via shared-ticker. */
export function useTimeLeft(meal: MealType): { ms: number; str: string } | null {
  const [now, setNow] = useState<Date>(() => new Date());

  const tick = useCallback(() => setNow(new Date()), []);

  useEffect(() => subscribeTick(tick), [tick]);

  const date = nextDeliveryDate(meal, now);
  if (!isBeforeCutoff(meal, date, now)) return null;

  const ms = computeCutoff(meal, date).getTime() - now.getTime();
  if (ms <= 0) return null;

  return { ms, str: fmt(ms) };
}

/** Inline countdown chip for a meal. Shows nothing when ordering is closed. */
export function CutoffTimer({ meal, className = "" }: { meal: MealType; className?: string }) {
  const left = useTimeLeft(meal);
  if (!left) return null;

  const urgent = left.ms < 30 * 60 * 1_000;   // < 30 min → red
  const warning = left.ms < 2 * 3_600_000;     // < 2 h   → amber

  const color = urgent
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : warning
    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-400/30"
    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-400/30";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${color} ${className}`}
    >
      <Timer className="h-3 w-3" />
      {left.str}
    </span>
  );
}
