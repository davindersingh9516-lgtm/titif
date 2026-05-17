export type MealType = "breakfast" | "lunch" | "dinner";
export type Window = "round_1" | "round_2";

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export const WINDOW_LABEL: Record<MealType, Record<Window, string>> = {
  breakfast: { round_1: "7 – 8 AM",  round_2: "8 – 9 AM"  },
  lunch:     { round_1: "12 – 1 PM", round_2: "1 – 2 PM"  },
  dinner:    { round_1: "7 – 8 PM",  round_2: "8 – 9 PM"  },
};

// ─── IST helpers ─────────────────────────────────────────────────────────────
/** IST = UTC + 5h 30m = 19 800 000 ms */
const IST_MS = 19_800_000;

/**
 * Returns a Date whose getUTC*() methods give IST values.
 * Safe regardless of device timezone.
 */
export function toIST(d = new Date()): Date {
  return new Date(d.getTime() + IST_MS);
}

/**
 * Returns IST midnight of the IST calendar day that `d` falls on,
 * expressed as a UTC Date.
 * e.g. "14 May 2026 00:00:00 IST" → "13 May 2026 18:30:00 UTC"
 */
export function istMidnight(d = new Date()): Date {
  const ist = toIST(d);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS,
  );
}

// ─── Cutoff logic ─────────────────────────────────────────────────────────────
/**
 * Cutoff times (IST):
 *   breakfast → 23:59 the night BEFORE delivery  (order previous day, any time)
 *   lunch     → 10:00 AM on delivery day
 *   dinner    → 15:00 (3:00 PM) on delivery day
 */
export function isBeforeCutoff(meal: MealType, deliveryDate: Date, now = new Date()): boolean {
  const mid = istMidnight(deliveryDate).getTime(); // UTC ms of IST midnight on delivery day
  const cutoff =
    meal === "breakfast" ? mid -  60_000        // 23:59 prev night IST
    : meal === "lunch"   ? mid + 36_000_000     // 10:00 IST  (10 × 3 600 000 ms)
    :                      mid + 54_000_000;    // 15:00 IST  (15 × 3 600 000 ms)
  return now.getTime() <= cutoff;
}

/** Returns the next delivery date for a meal as IST midnight (UTC Date). */
export function nextDeliveryDate(meal: MealType, now = new Date()): Date {
  const today = istMidnight(now);
  if (isBeforeCutoff(meal, today, now)) return today;
  return new Date(today.getTime() + 86_400_000); // +1 day
}

/** Returns YYYY-MM-DD in IST calendar (safe for DB date columns). */
export function isoDate(d: Date): string {
  const ist = toIST(d);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the currently orderable meal based on IST hour.
 * 00–09 → lunch (today) | 10–14 → dinner (today) | 15–23 → breakfast (tomorrow)
 */
export function activeMeal(now = new Date()): MealType {
  const h = toIST(now).getUTCHours();
  if (h < 10) return "lunch";
  if (h < 15) return "dinner";
  return "breakfast";
}

// ─── Formatting ───────────────────────────────────────────────────────────────
export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function fmtINR(n: number): string {
  return `₹${n.toFixed(0)}`;
}
