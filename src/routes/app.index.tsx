import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Sun, Sunset, Moon, ChevronRight, Wallet, ShoppingBag, Gift, LifeBuoy, ShoppingCart, Clock, AlertCircle } from "lucide-react";
import {
  fmtINR, isBeforeCutoff, MEAL_LABEL, nextDeliveryDate, formatDate, toIST, isoDate, activeMeal, type MealType,
} from "@/lib/meals";
import { NotificationBell } from "@/components/customer/NotificationBell";
import { useCart } from "@/lib/cart";
import { usePricing } from "@/hooks/use-pricing";
import { Skeleton } from "@/components/ui/skeleton";
import { CutoffTimer } from "@/components/customer/CutoffTimer";

type WeeklyThali = {
  id: string; thali_name: string; description: string | null; meal_type: MealType;
  items: string[]; items_mini: string[]; items_large: string[];
  price_mini: number; price_large: number; day_of_week: number;
};

export const Route = createFileRoute("/app/")({
  component: Home,
});

function Home() {
  const { user } = useAuth();
  const pricing = usePricing();
  const cartCount = useCart((s) => s.items.reduce((a, b) => a + b.qty, 0));

  const { data: wallet } = useQuery({
    queryKey: ["wallet", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("balance").eq("user_id", user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Active meal based on current IST time — recomputed at most once per minute via useMemo
  const { now, currentMeal, currentMealDate, currentMealDow, currentMealOpen, isTomorrow } = useMemo(() => {
    const n = new Date();
    const meal = activeMeal(n);
    const mealDate = nextDeliveryDate(meal, n);
    return {
      now: n,
      currentMeal: meal,
      currentMealDate: mealDate,
      currentMealDow: toIST(mealDate).getUTCDay(),
      currentMealOpen: isBeforeCutoff(meal, mealDate, n),
      isTomorrow: isoDate(mealDate) !== isoDate(n),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: previewThali } = useQuery({
    queryKey: ["preview-thali-home", currentMeal, currentMealDow],
    queryFn: async () => {
      const { data } = await supabase
        .rpc("thali_for_day" as any, { p_day: currentMealDow, p_meal: currentMeal });
      const rows = (data ?? []) as WeeklyThali[];
      return rows[0] ?? null;
    },
  });

  const meals: { type: MealType; icon: typeof Sun; tint: string }[] = [
    { type: "breakfast", icon: Sun,    tint: "from-amber-200/50 to-orange-100/50" },
    { type: "lunch",     icon: Sunset, tint: "from-orange-200/50 to-rose-100/50" },
    { type: "dinner",    icon: Moon,   tint: "from-indigo-200/40 to-purple-100/40" },
  ];

  return (
    <div>
      <div className="bg-gradient-warm px-5 pt-8 pb-6 safe-top">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Hi {profile?.full_name?.split(" ")[0] || "there"} 👋</div>
            <div className="mt-1 text-xl font-bold tracking-tight">
              {isTomorrow ? "Kal ka" : "Aaj ka"} {MEAL_LABEL[currentMeal]}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{formatDate(currentMealDate)}</div>
          </div>
          <div className="flex items-center gap-1">
            {cartCount > 0 && (
              <Link to="/app/cart" className="relative rounded-full p-2 hover:bg-white/20 transition-colors">
                <ShoppingCart className="h-5 w-5" />
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {cartCount > 9 ? "9+" : cartCount}
                </span>
              </Link>
            )}
            <NotificationBell />
          </div>
        </div>

        <Link
          to="/app/wallet"
          className="press mt-5 flex items-center justify-between rounded-2xl bg-card p-4 shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-primary p-2.5 shadow-glow">
              <Wallet className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Wallet balance</div>
              {wallet === undefined ? (
                <Skeleton className="mt-1 h-6 w-20" />
              ) : (
                <div className="text-lg font-bold tabular-nums">{fmtINR(Number(wallet?.balance ?? 0))}</div>
              )}
            </div>
          </div>
          <div className="text-sm font-semibold text-primary">Add money</div>
        </Link>
      </div>

      <div className="px-5 pt-6">
        {/* Active meal thali preview */}
        {previewThali && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isTomorrow ? "Kal" : "Aaj"} · {MEAL_LABEL[currentMeal]}
              </h2>
              <Link to="/app/menu" search={{ meal: currentMeal }} className="text-xs text-primary font-semibold">
                Full menu →
              </Link>
            </div>

            {currentMeal === "breakfast" ? (
              /* Breakfast: single fixed card */
              <Link
                to="/app/menu"
                search={{ meal: "breakfast" }}
                className="press block rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 p-4 shadow-sm"
              >
                <div className="font-bold leading-tight">{previewThali.thali_name}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {previewThali.items.map((item, i) => (
                    <span key={i} className="rounded-full border border-amber-200 bg-white/60 dark:bg-amber-900/30 px-2 py-0.5 text-xs">
                      {item}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-amber-700 dark:text-amber-400">
                    Fixed {fmtINR(pricing.breakfast)}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${currentMealOpen ? "bg-amber-600" : "bg-muted-foreground"}`}>
                    {currentMealOpen ? "Order" : "Closed"}
                  </span>
                </div>
              </Link>
            ) : (
              /* Lunch / Dinner: two cards side by side */
              <div className="grid grid-cols-2 gap-2">
                {/* Mini */}
                <Link
                  to="/app/menu"
                  search={{ meal: currentMeal }}
                  className="press rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/8 to-primary/4 p-3 shadow-sm flex flex-col gap-2"
                >
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-primary">Mini Thali</div>
                    <div className="text-base font-bold mt-0.5">{fmtINR(pricing.mini)}</div>
                  </div>
                  <ul className="space-y-0.5 flex-1">
                    {(previewThali.items_mini.length ? previewThali.items_mini : previewThali.items).slice(0, 5).map((it, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground leading-snug">· {it}</li>
                    ))}
                    {previewThali.items_mini.length > 5 && (
                      <li className="text-[11px] text-primary font-medium">+{previewThali.items_mini.length - 5} more</li>
                    )}
                  </ul>
                  <span className="mt-auto block rounded-lg bg-primary py-1 text-center text-[11px] font-semibold text-primary-foreground">
                    Order Mini
                  </span>
                </Link>

                {/* Large */}
                <Link
                  to="/app/menu"
                  search={{ meal: currentMeal }}
                  className="press rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-50/80 to-orange-50/60 dark:from-amber-950/30 dark:to-orange-950/20 p-3 shadow-sm flex flex-col gap-2"
                >
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Large Thali</div>
                    <div className="text-base font-bold mt-0.5">{fmtINR(pricing.large)}</div>
                  </div>
                  <ul className="space-y-0.5 flex-1">
                    {(previewThali.items_large.length ? previewThali.items_large : previewThali.items).slice(0, 5).map((it, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground leading-snug">· {it}</li>
                    ))}
                    {previewThali.items_large.length > 5 && (
                      <li className="text-[11px] text-amber-600 font-medium">+{previewThali.items_large.length - 5} more</li>
                    )}
                  </ul>
                  <span className="mt-auto block rounded-lg bg-amber-500 py-1 text-center text-[11px] font-semibold text-white">
                    Order Large
                  </span>
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Order windows info card */}
        <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">Order &amp; Delivery Windows</span>
          </div>
          <div className="divide-y divide-border">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                <Sun className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Breakfast</div>
                <div className="text-[11px] text-muted-foreground">Order by <span className="font-bold text-foreground">11:59 PM</span> previous night</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-muted-foreground">Delivered</div>
                <div className="text-xs font-bold">7:00–9:00 AM</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
                <Sunset className="h-3.5 w-3.5 text-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Lunch</div>
                <div className="text-[11px] text-muted-foreground">Order by <span className="font-bold text-foreground">10:00 AM</span> same day</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-muted-foreground">Delivered</div>
                <div className="text-xs font-bold">12:00–2:00 PM</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
                <Moon className="h-3.5 w-3.5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Dinner</div>
                <div className="text-[11px] text-muted-foreground">Order by <span className="font-bold text-foreground">3:00 PM</span> same day</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-muted-foreground">Delivered</div>
                <div className="text-xs font-bold">7:00–9:00 PM</div>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-amber-200/50 bg-amber-50/70 px-4 py-2.5 dark:bg-amber-900/20">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              Once kitchen begins prep at cutoff, orders <span className="font-semibold">cannot be cancelled.</span>
            </p>
          </div>
        </div>

        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">All meals</h2>
        <div className="space-y-3 stagger">
          {meals.map(({ type, icon: Icon, tint }) => {
            const mDate = nextDeliveryDate(type, now);
            const mOpen = isBeforeCutoff(type, mDate, now);
            const isActive = type === currentMeal;
            const mTomorrow = isoDate(mDate) !== isoDate(now);
            return (
              <Link
                key={type}
                to="/app/menu"
                search={{ meal: type }}
                className={`press flex items-center gap-4 rounded-2xl border p-4 shadow-sm ${isActive ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
              >
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${tint}`}>
                  <Icon className={`h-6 w-6 ${mOpen ? "text-foreground/80" : "text-muted-foreground/50"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className={`font-semibold ${!mOpen ? "text-muted-foreground" : ""}`}>{MEAL_LABEL[type]}</div>
                    {isActive && mOpen && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">Now open</span>}
                    {mOpen && <CutoffTimer meal={type} />}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {mOpen
                      ? `${mTomorrow ? "Tomorrow" : "Today"} · ${formatDate(mDate)}`
                      : "Cutoff passed — next slot tomorrow"}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Link>
            );
          })}
        </div>

        <Link
          to="/app/orders"
          className="press mt-6 flex items-center justify-between rounded-2xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-3">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <span className="font-medium">Your orders</span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        <Link
          to="/app/refer"
          className="press mt-3 flex items-center justify-between rounded-2xl border border-border bg-gradient-to-r from-amber-50 to-orange-50 p-4 dark:from-amber-950/30 dark:to-orange-950/30"
        >
          <div className="flex items-center gap-3">
            <Gift className="h-5 w-5 text-amber-600" />
            <div>
              <div className="font-medium">Refer a friend</div>
              <div className="text-xs text-muted-foreground">Both get ₹50 in wallet</div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        <Link
          to="/app/support"
          className="press mt-3 mb-6 flex items-center justify-between rounded-2xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-3">
            <LifeBuoy className="h-5 w-5 text-primary" />
            <span className="font-medium">Help & support</span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}
