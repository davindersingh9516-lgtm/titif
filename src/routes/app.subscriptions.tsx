import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/customer/AppHeader";
import { isoDate, toIST, fmtINR, MEAL_LABEL, type MealType } from "@/lib/meals";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/hooks/use-confirm";
import { usePricing } from "@/hooks/use-pricing";
import {
  ChevronLeft, ChevronRight, CalendarDays, Repeat2, PauseCircle,
  XCircle, CheckCircle2, Clock, Wallet, Utensils,
} from "lucide-react";

export const Route = createFileRoute("/app/subscriptions")({
  component: SubscriptionsPage,
});

const MEAL_COLOR: Record<string, string> = {
  breakfast: "bg-amber-500",
  lunch:     "bg-green-500",
  dinner:    "bg-purple-500",
};
const MEAL_SHORT: Record<string, string> = { breakfast: "B", lunch: "L", dinner: "D" };
// Prices come from admin settings via usePricing() — no hardcoded values here.

function todayIST() { return isoDate(new Date()); }
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T00:00:00+05:30");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function formatDayLabel(dateStr: string) {
  return new Date(dateStr + "T00:00:00+05:30").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}
function daysRemaining(endDate: string) {
  const today = todayIST();
  const end = endDate;
  if (end < today) return 0;
  let count = 0;
  let cur = today;
  while (cur <= end) { count++; cur = addDays(cur, 1); }
  return count;
}

// ─── Main page ────────────────────────────────────────────────────────────────
function SubscriptionsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirmDialog = useConfirm();

  const { data: sub, isLoading } = useQuery({
    queryKey: ["my-subscription", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("*")
        .in("status", ["active", "paused"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: pauses = [] } = useQuery({
    queryKey: ["sub-pauses", sub?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_pauses")
        .select("pause_date, meal_type")
        .eq("subscription_id", sub!.id);
      return (data ?? []) as { pause_date: string; meal_type: MealType }[];
    },
    enabled: !!sub,
  });

  const { data: subOrders = [] } = useQuery({
    queryKey: ["sub-orders", sub?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, delivery_date, meal_type, status")
        .gte("delivery_date", sub!.start_date)
        .lte("delivery_date", sub!.end_date);
      return (data ?? []) as { id: string; delivery_date: string; meal_type: MealType; status: string }[];
    },
    enabled: !!sub,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("cancel_subscription", { p_sub_id: sub!.id });
      if (error) throw error;
      return data as { cancelled_orders: number; refund_total: number } | null;
    },
    onSuccess: (data) => {
      const refund = data?.refund_total ?? 0;
      const count = data?.cancelled_orders ?? 0;
      if (refund > 0)
        toast.success(`Subscription cancelled — ₹${refund} refunded for ${count} upcoming order${count > 1 ? "s" : ""}`);
      else
        toast.success("Subscription cancelled");
      qc.invalidateQueries({ queryKey: ["my-subscription"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div>
        <AppHeader title="My Subscription" back="/app" />
        <div className="px-4 py-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppHeader title="My Subscription" back="/app" />
      {sub ? (
        <ActiveSubscription
          sub={sub}
          pauses={pauses}
          orders={subOrders}
          onCancel={async () => {
            const ok = await confirmDialog({
              title: "Cancel subscription?",
              body: "Your upcoming orders won't be auto-placed. You can start a new plan anytime.",
              confirmLabel: "Cancel plan",
              variant: "destructive",
            });
            if (ok) cancelMutation.mutate();
          }}
        />
      ) : (
        <SetupWizard onCreated={() => qc.invalidateQueries({ queryKey: ["my-subscription"] })} />
      )}
    </div>
  );
}

// ─── Setup Wizard ─────────────────────────────────────────────────────────────
function SetupWizard({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const pricing = usePricing();
  const [step, setStep] = useState(0);
  const [meals, setMeals] = useState<MealType[]>(["lunch"]);
  const [size, setSize] = useState<"mini" | "large">("mini");
  const [window, setWindow] = useState<"round_1" | "round_2">("round_1");

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, address").eq("id", user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("create_subscription", {
        p_meal_types: meals,
        p_size: size,
        p_window: window,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Subscription created!"); onCreated(); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMeal = (m: MealType) =>
    setMeals((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);

  const dailyCost = meals.reduce((sum, m) => {
    const price = m === "breakfast" ? pricing.breakfast : size === "mini" ? pricing.mini : pricing.large;
    return sum + price;
  }, 0);
  const monthlyCost = dailyCost * 30;

  return (
    <div className="px-4 py-6">
      {/* Hero */}
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
            <Repeat2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-bold text-foreground">Auto-order, every day</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Your tiffin auto-placed from wallet. Pause any day, anytime.
            </div>
          </div>
        </div>
      </div>

      {/* Step 1: Choose meals */}
      <div className="space-y-5">
        <div>
          <div className="mb-3 text-sm font-semibold text-foreground">Which meals?</div>
          <div className="grid grid-cols-3 gap-2">
            {(["breakfast", "lunch", "dinner"] as MealType[]).map((m) => {
              const active = meals.includes(m);
              return (
                <button
                  key={m}
                  onClick={() => toggleMeal(m)}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 py-4 text-xs font-semibold transition ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <span className={`h-7 w-7 rounded-full flex items-center justify-center text-base ${active ? "bg-primary/20" : "bg-muted"}`}>
                    {m === "breakfast" ? "☀️" : m === "lunch" ? "🍱" : "🌙"}
                  </span>
                  {MEAL_LABEL[m]}
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {m === "breakfast" ? `₹${pricing.breakfast} fixed` : `₹${size === "mini" ? pricing.mini : pricing.large}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Size (for lunch/dinner) */}
        {meals.some((m) => m !== "breakfast") && (
          <div>
            <div className="mb-3 text-sm font-semibold text-foreground">Thali size</div>
            <div className="grid grid-cols-2 gap-2">
              {(["mini", "large"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition ${
                    size === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {s === "mini" ? `Mini · ₹${pricing.mini}` : `Large · ₹${pricing.large}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Window */}
        <div>
          <div className="mb-3 text-sm font-semibold text-foreground">Delivery slot</div>
          <div className="grid grid-cols-2 gap-2">
            {([["round_1", "Slot 1 (Earlier)"], ["round_2", "Slot 2 (Later)"]] as const).map(([w, label]) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`rounded-xl border-2 py-3 text-sm font-semibold transition ${
                  window === w ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Discount badge */}
        {size === "large" && meals.length >= 2 && (
          <div className="flex items-center gap-2 rounded-xl bg-green-500/10 border border-green-500/30 px-3 py-2.5">
            <span className="text-lg">🎉</span>
            <div>
              <div className="text-sm font-bold text-green-700 dark:text-green-400">10% loyalty discount!</div>
              <div className="text-[11px] text-green-600 dark:text-green-500">
                Large thali + combo meal · keep consistent (max 2-day break allowed)
              </div>
            </div>
          </div>
        )}

        {/* Price summary */}
        {meals.length > 0 && (
          <div className="rounded-2xl border border-border bg-card px-4 py-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost estimate</div>
            {meals.map((m) => {
              const basePrice = m === "breakfast" ? pricing.breakfast : size === "mini" ? pricing.mini : pricing.large;
              const isDiscountEligible = size === "large" && meals.length >= 2;
              const price = isDiscountEligible ? Math.round(basePrice * 0.9) : basePrice;
              return (
                <div key={m} className="flex items-center justify-between text-sm">
                  <span>{MEAL_LABEL[m]}</span>
                  <span className="font-semibold">
                    {isDiscountEligible && basePrice !== price ? (
                      <>
                        <span className="line-through text-muted-foreground mr-1.5">₹{basePrice}</span>
                        <span className="text-green-600">₹{price}/day</span>
                      </>
                    ) : (
                      `₹${price}/day`
                    )}
                  </span>
                </div>
              );
            })}
            <div className="border-t border-border pt-2 flex items-center justify-between">
              <span className="text-sm font-bold">~Monthly total</span>
              <span className="text-sm font-bold text-primary">
                {fmtINR(size === "large" && meals.length >= 2 ? Math.round(monthlyCost * 0.9) : monthlyCost)}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Charged daily from wallet · pause or cancel anytime
            </div>
          </div>
        )}

        {/* Delivery address */}
        {profile?.address && (
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Deliver to: </span>{profile.address}
          </div>
        )}

        <button
          disabled={meals.length === 0 || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="w-full rounded-2xl bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50 transition active:scale-95"
        >
          {createMutation.isPending ? "Setting up…" : `Start Subscription · ${fmtINR(dailyCost)}/day`}
        </button>

        <p className="text-center text-[11px] text-muted-foreground leading-relaxed">
          Subscription starts tomorrow. You can pause or cancel any time before the meal cutoff.
          Pausing also cancels & refunds any already-placed order for that day.
        </p>
      </div>
    </div>
  );
}

// ─── Active Subscription ──────────────────────────────────────────────────────
function ActiveSubscription({
  sub,
  pauses,
  orders,
  onCancel,
}: {
  sub: any;
  pauses: { pause_date: string; meal_type: MealType }[];
  orders: { id: string; delivery_date: string; meal_type: MealType; status: string }[];
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const pricing = usePricing();
  const today = todayIST();

  // Month navigation — only within subscription range
  const subStartMonth = sub.start_date.slice(0, 7); // "YYYY-MM"
  const subEndMonth   = sub.end_date.slice(0, 7);
  const [viewMonthStr, setViewMonthStr] = useState(() => {
    const tm = today.slice(0, 7);
    return tm >= subStartMonth && tm <= subEndMonth ? tm : subStartMonth;
  });

  const canPrevMonth = viewMonthStr > subStartMonth;
  const canNextMonth = viewMonthStr < subEndMonth;

  const pauseMutation = useMutation({
    mutationFn: async ({ date, meal }: { date: string; meal: MealType }) => {
      const { error } = await (supabase as any).rpc("pause_subscription_day", {
        p_sub_id: sub.id,
        p_date: date,
        p_meal_type: meal,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Day paused — wallet refunded if order existed");
      qc.invalidateQueries({ queryKey: ["sub-pauses"] });
      qc.invalidateQueries({ queryKey: ["sub-orders"] });
    },
    onError: (e: any) => {
      const msg: Record<string, string> = {
        cutoff_passed: "Cutoff has passed for this meal today",
        subscription_not_found: "Subscription not found",
      };
      toast.error(msg[e.message] ?? e.message);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({ date, meal }: { date: string; meal: MealType }) => {
      const { error } = await (supabase as any).rpc("resume_subscription_day", {
        p_sub_id: sub.id,
        p_date: date,
        p_meal_type: meal,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resumed — order will be placed next cycle");
      qc.invalidateQueries({ queryKey: ["sub-pauses"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Build calendar days for this month
  const calDays = useMemo(() => buildCalendarDays(
    sub, pauses, orders, viewMonthStr, today
  ), [sub, pauses, orders, viewMonthStr, today]);

  const remaining = daysRemaining(sub.end_date);
  const dailyCost = (sub.meal_types as MealType[]).reduce((s: number, m: MealType) => {
    return s + (m === "breakfast" ? pricing.breakfast : sub.size === "mini" ? pricing.mini : pricing.large);
  }, 0);

  const handleMealClick = async (date: string, meal: MealType, status: string) => {
    if (status === "placed" || status === "preparing") {
      const ok = await confirmDialog({
        title: `Pause ${MEAL_LABEL[meal]}?`,
        body: `${formatDayLabel(date)} — the order will be cancelled and refunded to your wallet.`,
        confirmLabel: "Pause & refund",
        variant: "pause",
      });
      if (ok) pauseMutation.mutate({ date, meal });
    } else if (status === "paused") {
      const ok = await confirmDialog({
        title: `Resume ${MEAL_LABEL[meal]}?`,
        body: `${formatDayLabel(date)} — order will be placed on the next cycle.`,
        confirmLabel: "Resume",
        variant: "info",
      });
      if (ok) resumeMutation.mutate({ date, meal });
    } else if (status === "active") {
      const ok = await confirmDialog({
        title: `Pause ${MEAL_LABEL[meal]}?`,
        body: `${formatDayLabel(date)} — no order will be placed for this meal.`,
        confirmLabel: "Pause",
        variant: "pause",
      });
      if (ok) pauseMutation.mutate({ date, meal });
    }
  };

  const [year, month] = viewMonthStr.split("-").map(Number);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Subscription header card */}
      <div className="rounded-2xl border border-border bg-card px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap gap-1.5 mb-1">
              {(sub.meal_types as MealType[]).map((m: MealType) => (
                <span key={m} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${MEAL_COLOR[m]}`}>
                  {MEAL_SHORT[m]} {MEAL_LABEL[m]}
                </span>
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {sub.size === "fixed" ? "Fixed" : sub.size === "mini" ? "Mini" : "Large"} ·
              Slot {sub.delivery_window === "round_1" ? "1" : "2"} ·
              {" "}{remaining} day{remaining !== 1 ? "s" : ""} left
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDayLabel(sub.start_date)} → {formatDayLabel(sub.end_date)}
            </div>
          </div>
          <div className="text-right shrink-0">
            {sub.discount_pct > 0 ? (
              <>
                <div className="text-[11px] line-through text-muted-foreground">{fmtINR(dailyCost)}</div>
                <div className="text-base font-bold text-green-600">{fmtINR(Math.round(dailyCost * 0.9))}</div>
                <div className="text-[10px] text-green-600 font-semibold">-10% / day</div>
              </>
            ) : (
              <>
                <div className="text-base font-bold text-primary">{fmtINR(dailyCost)}</div>
                <div className="text-[10px] text-muted-foreground">per day</div>
              </>
            )}
          </div>
        </div>

        {/* Discount status row */}
        {sub.size === "large" && (sub.meal_types as MealType[]).length >= 2 && (
          <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
            sub.discount_pct > 0
              ? "bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400"
              : "bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400"
          }`}>
            <span>{sub.discount_pct > 0 ? "✅" : "⚠️"}</span>
            {sub.discount_pct > 0
              ? "10% loyalty discount active — keep your streak!"
              : "Discount forfeited — 3+ consecutive break days detected"}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <Link
            to="/app/wallet"
            className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground"
          >
            <Wallet className="h-3.5 w-3.5" /> Top up wallet
          </Link>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
          >
            <XCircle className="h-3.5 w-3.5" /> Cancel plan
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300">
        Tap any meal badge to pause or resume that day. Changes must be made before the meal's cutoff time.
      </div>

      {/* Month calendar */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Month header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={() => {
              const [y, m] = viewMonthStr.split("-").map(Number);
              const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
              setViewMonthStr(prev);
            }}
            disabled={!canPrevMonth}
            className="rounded-lg p-1.5 hover:bg-muted disabled:opacity-30 transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{monthLabel}</span>
          <button
            onClick={() => {
              const [y, m] = viewMonthStr.split("-").map(Number);
              const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
              setViewMonthStr(next);
            }}
            disabled={!canNextMonth}
            className="rounded-lg p-1.5 hover:bg-muted disabled:opacity-30 transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="py-1.5 text-center text-[10px] font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7">
          {calDays.map((cell, idx) => (
            <DayCell
              key={idx}
              cell={cell}
              subMeals={sub.meal_types as MealType[]}
              onMealClick={handleMealClick}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />Active</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300" />Paused</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />Order placed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-600" />Delivered</span>
      </div>
    </div>
  );
}

// ─── Day Cell ─────────────────────────────────────────────────────────────────
type CalCell =
  | { type: "empty" }
  | {
      type: "day";
      date: string;
      dayNum: number;
      isToday: boolean;
      isPast: boolean;
      inSub: boolean;
      meals: { meal: MealType; status: "active" | "paused" | "placed" | "delivered" | "cancelled" | "past" }[];
    };

function DayCell({
  cell,
  subMeals,
  onMealClick,
}: {
  cell: CalCell;
  subMeals: MealType[];
  onMealClick: (date: string, meal: MealType, status: string) => void;
}) {
  if (cell.type === "empty") {
    return <div className="h-16 border-b border-r border-border/50 last:border-r-0" />;
  }

  const { date, dayNum, isToday, isPast, inSub, meals } = cell;

  if (!inSub) {
    return (
      <div className="h-16 border-b border-r border-border/50 last:border-r-0 p-1">
        <div className={`text-[11px] font-medium ${isPast ? "text-muted-foreground/40" : "text-muted-foreground/60"}`}>
          {dayNum}
        </div>
      </div>
    );
  }

  const mealStatusColor: Record<string, string> = {
    active:    "bg-green-500",
    paused:    "bg-slate-300 dark:bg-slate-600",
    placed:    "bg-amber-400",
    preparing: "bg-amber-500",
    delivered: "bg-green-600",
    cancelled: "bg-red-300",
    past:      "bg-slate-200 dark:bg-slate-700",
  };

  return (
    <div
      className={`h-16 border-b border-r border-border/50 last:border-r-0 p-1 transition ${
        isToday ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : ""
      } ${isPast ? "opacity-60" : ""}`}
    >
      <div className={`text-[11px] font-semibold mb-1 ${isToday ? "text-primary" : "text-foreground"}`}>
        {dayNum}
      </div>
      <div className="flex flex-wrap gap-0.5">
        {meals.map(({ meal, status }) => {
          const canInteract = !isPast && (status === "active" || status === "paused" || status === "placed" || (status as string) === "preparing");
          return (
            <button
              key={meal}
              disabled={!canInteract}
              onClick={() => canInteract && onMealClick(date, meal, status)}
              title={`${MEAL_LABEL[meal]}: ${status}`}
              className={`h-4 w-4 rounded-sm text-[8px] font-bold text-white flex items-center justify-center transition ${
                mealStatusColor[status] ?? "bg-slate-300"
              } ${canInteract ? "hover:opacity-80 active:scale-90" : "cursor-default"}`}
            >
              {MEAL_SHORT[meal]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Calendar builder ─────────────────────────────────────────────────────────
function buildCalendarDays(
  sub: any,
  pauses: { pause_date: string; meal_type: MealType }[],
  orders: { id: string; delivery_date: string; meal_type: MealType; status: string }[],
  viewMonthStr: string,
  today: string
): CalCell[] {
  const [year, month] = viewMonthStr.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  // Monday-first: getDay() returns 0=Sun...6=Sat, convert to 0=Mon...6=Sun
  const firstDow = new Date(year, month - 1, 1).getDay();
  const padStart = (firstDow + 6) % 7; // 0=Mon → pad=0, 0=Sun → pad=6
  const totalCells = Math.ceil((padStart + daysInMonth) / 7) * 7;

  const cells: CalCell[] = [];

  // Leading empty cells
  for (let i = 0; i < padStart; i++) cells.push({ type: "empty" });

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewMonthStr}-${String(d).padStart(2, "0")}`;
    const inSub = dateStr >= sub.start_date && dateStr <= sub.end_date;
    const isPast = dateStr < today;
    const isToday = dateStr === today;

    const meals = (sub.meal_types as MealType[]).map((meal: MealType) => {
      if (!inSub) return { meal, status: "past" as const };
      const isPaused = pauses.some((p) => p.pause_date === dateStr && p.meal_type === meal);
      const order = orders.find((o) => o.delivery_date === dateStr && o.meal_type === meal);
      let status: "active" | "paused" | "placed" | "delivered" | "cancelled" | "past" = "active";
      if (order) {
        status = order.status as any;
      } else if (isPaused) {
        status = "paused";
      } else if (isPast) {
        status = "past";
      } else {
        status = "active";
      }
      return { meal, status };
    });

    cells.push({ type: "day", date: dateStr, dayNum: d, isToday, isPast, inSub, meals });
  }

  // Trailing empty cells
  const trailing = totalCells - padStart - daysInMonth;
  for (let i = 0; i < trailing; i++) cells.push({ type: "empty" });

  return cells;
}
