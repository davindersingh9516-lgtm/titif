import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/customer/AppHeader";
import { fmtINR, isBeforeCutoff, MEAL_LABEL, nextDeliveryDate, formatDate, toIST, activeMeal, type MealType } from "@/lib/meals";
import { Plus, Minus, ShoppingBag, AlertCircle, ChefHat, Check } from "lucide-react";
import { useCart } from "@/lib/cart";
import { usePricing } from "@/hooks/use-pricing";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CutoffTimer } from "@/components/customer/CutoffTimer";
import { z } from "zod";

const searchSchema = z.object({ meal: z.enum(["breakfast", "lunch", "dinner"]).optional() });

export const Route = createFileRoute("/app/menu")({
  validateSearch: searchSchema,
  component: MenuPage,
});

type WeeklyThali = {
  id: string; day_of_week: number; meal_type: MealType;
  thali_name: string; description: string | null;
  items: string[]; items_mini: string[]; items_large: string[];
  price_mini: number; price_large: number; is_available: boolean;
};

const TABS: MealType[] = ["breakfast", "lunch", "dinner"];

function MenuPage() {
  const { meal: mealParam } = Route.useSearch();
  const meal: MealType = mealParam ?? activeMeal();
  const nav = useNavigate();
  const cart = useCart();
  const pricing = usePricing();
  const date = nextDeliveryDate(meal);
  const open = isBeforeCutoff(meal, date);
  const todayDow = toIST(date).getUTCDay(); // IST day of week

  const { data: thali, isLoading } = useQuery({
    queryKey: ["today-thali", meal, todayDow],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("thali_for_day" as any, { p_day: todayDow, p_meal: meal });
      if (error) throw error;
      const rows = (data ?? []) as WeeklyThali[];
      return rows[0] ?? null;
    },
  });

  const isBreakfast = meal === "breakfast";
  const fixedId = thali ? `${thali.id}_fixed` : null;
  const miniId  = thali ? `${thali.id}_mini`  : null;
  const largeId = thali ? `${thali.id}_large` : null;

  const fixedInCart = cart.items.find((c) => c.id === fixedId);
  const miniInCart  = cart.items.find((c) => c.id === miniId);
  const largeInCart = cart.items.find((c) => c.id === largeId);

  const cartTotal = cart.items.reduce((a, b) => {
    const p = b.size === "fixed" ? pricing.breakfast : b.size === "mini" ? pricing.mini : pricing.large;
    return a + p * b.qty;
  }, 0);
  const cartCount = cart.items.reduce((a, b) => a + b.qty, 0);

  const addBreakfast = () => {
    if (!thali || !open) return;
    cart.add({ id: fixedId!, name: thali.thali_name, size: "fixed", price: pricing.breakfast, meal_type: "breakfast" });
  };

  const addToCart = (size: "mini" | "large") => {
    if (!thali || !open) return;
    const id    = size === "mini" ? miniId!  : largeId!;
    const price = size === "mini" ? pricing.mini : pricing.large;
    const label = size === "mini" ? "Mini" : "Large";
    cart.add({ id, name: `${thali.thali_name} (${label})`, size, price, meal_type: meal });
  };

  return (
    <div className="pb-32">
      <AppHeader title={MEAL_LABEL[meal]} back="/app" />

      {/* Meal tabs */}
      <div className="sticky top-0 z-20 border-b border-border bg-background px-3 pb-2 pt-1">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => nav({ to: "/app/menu", search: { meal: t } })}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                meal === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {MEAL_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Delivery: <span className="font-medium text-foreground">{formatDate(date)}</span>
          </span>
          {open ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600">
                <Check className="h-3 w-3" /> Open
              </span>
              <CutoffTimer meal={meal} />
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
              <AlertCircle className="h-3 w-3" /> Cutoff passed
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-5 space-y-4">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
            <div className="flex flex-wrap gap-2 pt-1">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-20 rounded-full" />)}
            </div>
          </div>
        )}

        {/* Thali card header */}
        {!isLoading && thali && (
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-primary/10 to-amber-50 dark:to-amber-950/20 px-5 py-4 border-b border-border">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
                  <ChefHat className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-tight">{thali.thali_name}</h2>
                  {thali.description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{thali.description}</p>
                  )}
                </div>
              </div>
            </div>

            {isBreakfast ? (
              /* ── BREAKFAST ── */
              <div className="px-5 py-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Aaj ka nashta
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {thali.items.map((item, i) => (
                      <span key={i} className="rounded-full border border-border bg-muted/50 px-3 py-1 text-sm">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <BreakfastOrderCard
                  price={pricing.breakfast}
                  inCart={fixedInCart}
                  disabled={!open}
                  onAdd={addBreakfast}
                  onInc={() => cart.setQty(fixedId!, (fixedInCart?.qty ?? 0) + 1)}
                  onDec={() => cart.setQty(fixedId!, (fixedInCart?.qty ?? 1) - 1)}
                />
              </div>
            ) : (
              /* ── LUNCH / DINNER ── */
              <div className="px-4 py-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Size chunein — sab items clearly listed hai
                </div>

                {/* Mini Thali */}
                <SizeCard
                  variant="mini"
                  label="Mini Thali"
                  sublabel="Roz ka khana — perfect quantity"
                  price={pricing.mini}
                  items={thali.items_mini.length ? thali.items_mini : thali.items}
                  inCart={miniInCart}
                  disabled={!open}
                  onAdd={() => addToCart("mini")}
                  onInc={() => miniInCart && cart.setQty(miniId!, miniInCart.qty + 1)}
                  onDec={() => miniInCart && cart.setQty(miniId!, miniInCart.qty - 1)}
                />

                {/* Large Thali */}
                <SizeCard
                  variant="large"
                  label="Large Thali"
                  sublabel="Bada pet — poora thali experience"
                  price={pricing.large}
                  items={thali.items_large.length ? thali.items_large : thali.items}
                  inCart={largeInCart}
                  disabled={!open}
                  onAdd={() => addToCart("large")}
                  onInc={() => largeInCart && cart.setQty(largeId!, largeInCart.qty + 1)}
                  onDec={() => largeInCart && cart.setQty(largeId!, largeInCart.qty - 1)}
                />
              </div>
            )}
          </div>
        )}

        {/* Cutoff notice */}
        {!isLoading && !open && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <div className="font-semibold">Ordering closed for this meal</div>
            <div className="mt-0.5 text-xs opacity-80">
              {meal === "breakfast" && "Book tomorrow's breakfast before midnight tonight."}
              {meal === "lunch" && "Lunch cutoff is 10:00 AM. Order again tomorrow before 10 AM."}
              {meal === "dinner" && "Dinner cutoff is 3:00 PM. Order again tomorrow before 3 PM."}
            </div>
          </div>
        )}

        {/* No thali state */}
        {!isLoading && !thali && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <ChefHat className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <div className="font-semibold text-muted-foreground">Aaj ka thali set nahi hua</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Admin ne aaj ka {MEAL_LABEL[meal].toLowerCase()} thali abhi tak plan nahi kiya.
            </div>
          </div>
        )}
      </div>

      {/* Sticky cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30" style={{ maxWidth: 480, marginInline: "auto" }}>
          <div className="mx-3 flex items-center justify-between rounded-2xl bg-gradient-to-r from-primary to-orange-500 p-3 shadow-lg">
            <div className="text-primary-foreground">
              <div className="text-[11px] uppercase tracking-wide opacity-80">{cartCount} item{cartCount > 1 ? "s" : ""}</div>
              <div className="text-base font-bold">{fmtINR(cartTotal)}</div>
            </div>
            <Button asChild variant="secondary" className="h-10 rounded-xl bg-card text-foreground hover:bg-card/90">
              <Link to="/app/cart">
                <ShoppingBag className="mr-1.5 h-4 w-4" /> View cart
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Breakfast: single fixed price card ── */
function BreakfastOrderCard({
  price, inCart, disabled, onAdd, onInc, onDec,
}: {
  price: number; inCart: { qty: number } | undefined;
  disabled: boolean; onAdd: () => void; onInc: () => void; onDec: () => void;
}) {
  return (
    <div className={`rounded-xl border-2 p-4 flex items-center justify-between gap-3 transition ${
      inCart ? "border-primary bg-primary/5" : "border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20"
    }`}>
      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Fixed price</div>
        <div className="text-2xl font-bold mt-0.5">{fmtINR(price)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">No mini/large — ek hi size</div>
      </div>
      {inCart ? (
        <div className="flex items-center gap-3">
          <button onClick={onDec} className="rounded-full border border-border bg-background p-2 shadow-sm active:scale-95">
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-xl font-bold w-8 text-center">{inCart.qty}</span>
          <button onClick={onInc} className="rounded-full bg-primary text-primary-foreground p-2 shadow-sm active:scale-95">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          disabled={disabled}
          onClick={onAdd}
          className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-40 active:scale-95 transition"
        >
          Order
        </button>
      )}
    </div>
  );
}

/* ── Lunch/Dinner size card — full width, clearly listed items ── */
function SizeCard({
  variant, label, sublabel, price, items, inCart, disabled, onAdd, onInc, onDec,
}: {
  variant: "mini" | "large";
  label: string; sublabel: string; price: number; items: string[];
  inCart: { qty: number } | undefined;
  disabled: boolean;
  onAdd: () => void; onInc: () => void; onDec: () => void;
}) {
  const isMini = variant === "mini";
  const activeRing   = isMini ? "border-primary ring-1 ring-primary/30 bg-primary/5" : "border-amber-400 ring-1 ring-amber-400/30 bg-amber-50/60 dark:bg-amber-950/20";
  const inactiveRing = isMini ? "border-primary/20 bg-primary/3" : "border-amber-300/40 bg-amber-50/30 dark:bg-amber-950/10";
  const headerBg     = isMini ? "bg-primary/10" : "bg-amber-500/10";
  const tagColor     = isMini ? "text-primary" : "text-amber-600";
  const priceColor   = isMini ? "text-primary" : "text-amber-700 dark:text-amber-400";
  const btnColor     = isMini ? "bg-primary text-primary-foreground" : "bg-amber-500 text-white";
  const incColor     = isMini ? "bg-primary text-primary-foreground" : "bg-amber-500 text-white";

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition ${inCart ? activeRing : inactiveRing}`}>
      {/* Header strip */}
      <div className={`${headerBg} px-4 py-3 flex items-center justify-between`}>
        <div>
          <div className={`text-[11px] font-bold uppercase tracking-wider ${tagColor}`}>{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
        </div>
        <div className={`text-xl font-bold ${priceColor}`}>{fmtINR(price)}</div>
      </div>

      {/* Items list */}
      <div className="px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Ismein hoga
        </div>
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 text-[10px] font-bold shrink-0 ${tagColor}`}>✓</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Order controls */}
      <div className="px-4 pb-4">
        {inCart ? (
          <div className="flex items-center gap-3">
            <button
              onClick={onDec}
              className="rounded-full border border-border bg-background p-2 shadow-sm active:scale-95 transition"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="flex-1 text-center text-lg font-bold">{inCart.qty}</span>
            <button
              onClick={onInc}
              className={`rounded-full ${incColor} p-2 shadow-sm active:scale-95 transition`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            disabled={disabled}
            onClick={onAdd}
            className={`w-full rounded-xl ${btnColor} py-2.5 text-sm font-semibold shadow-sm disabled:opacity-40 active:scale-95 transition`}
          >
            Add {label}
          </button>
        )}
      </div>
    </div>
  );
}
