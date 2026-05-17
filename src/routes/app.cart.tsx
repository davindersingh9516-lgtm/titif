import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { usePricing } from "@/hooks/use-pricing";
import { AppHeader } from "@/components/customer/AppHeader";
import { Button } from "@/components/ui/button";
import { fmtINR, isBeforeCutoff, nextDeliveryDate, istMidnight, isoDate, formatDate, WINDOW_LABEL } from "@/lib/meals";
import { Plus, Minus, MapPin, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/cart")({
  component: CartPage,
});

function CartPage() {
  const cart = useCart();
  const { user } = useAuth();
  const pricing = usePricing();
  // Always derive price from current settings, not the stale stored value
  const ep = (size: string) => size === "fixed" ? pricing.breakfast : size === "mini" ? pricing.mini : pricing.large;
  const nav = useNavigate();
  const [window, setWindow] = useState<"round_1" | "round_2">("round_1");
  const [busy, setBusy] = useState(false);

  const meal = cart.items[0]?.meal_type ?? "lunch";
  const date = nextDeliveryDate(meal);
  const open = isBeforeCutoff(meal, date);

  const { data: wallet } = useQuery({
    queryKey: ["wallet", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("balance").eq("user_id", user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const total = cart.items.reduce((a, b) => a + ep(b.size) * b.qty, 0);
  const balance = Number(wallet?.balance ?? 0);
  const enough = balance >= total;

  const place = async () => {
    if (!user) return;
    if (profileLoading) return; // wait for profile to load
    if (!profile?.address) {
      toast.error("Add delivery address in Profile first");
      nav({ to: "/app/profile" });
      return;
    }
    if (!enough) {
      toast.error("Insufficient wallet balance");
      nav({ to: "/app/wallet" });
      return;
    }
    setBusy(true);
    try {
      const { data: orderId, error } = await supabase.rpc("place_order", {
        p_meal: meal,
        p_delivery_date: isoDate(date),
        p_window: window,
        p_address: profile.address,
        p_lat: profile.lat ?? 0,
        p_lng: profile.lng ?? 0,
        p_items: cart.items.map((i) => ({ name: i.name, size: i.size, price: ep(i.size), qty: i.qty })),
        p_notes: undefined,
      });
      if (error) throw error;

      cart.clear();
      toast.success("Order placed!");
      nav({ to: "/app/track/$id", params: { id: orderId as unknown as string } });
    } catch (e: any) {
      const msg = String(e.message ?? "");
      if (msg.includes("cutoff_passed")) toast.error("Cutoff has passed for this meal");
      else if (msg.includes("order_already_exists")) toast.error("You already have an active order for this meal today");
      else if (msg.includes("menu_item_not_found")) toast.error("This menu item is not available right now");
      else if (msg.includes("insufficient_balance")) {
        toast.error("Insufficient wallet balance");
        nav({ to: "/app/wallet" });
      } else if (msg.includes("invalid_address")) toast.error("Add a valid delivery address");
      else toast.error(msg || "Failed to place order");
    } finally {
      setBusy(false);
    }
  };

  if (cart.items.length === 0) {
    return (
      <>
        <AppHeader title="Your cart" back="/app" hideCart />
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <div className="text-5xl">🍱</div>
          <p className="mt-4 text-muted-foreground">Your cart is empty</p>
          <Button asChild className="mt-6 bg-gradient-primary"><a href="/app">Browse menu</a></Button>
        </div>
      </>
    );
  }

  return (
    <div className="pb-40">
      <AppHeader title="Your cart" back="/app/menu" hideCart />

      <CutoffBanner meal={meal} date={date} />

      <section className="px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</h2>
          <button onClick={() => cart.clear()} className="text-xs text-destructive/70 hover:text-destructive transition">
            Clear all
          </button>
        </div>
        <div className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
          {cart.items.map((it) => (
            <div key={it.id} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm font-semibold">{it.name}</div>
                <div className="text-xs text-muted-foreground">{fmtINR(ep(it.size))} · {it.size}</div>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-primary/10 p-1">
                <button onClick={() => cart.setQty(it.id, it.qty - 1)} className="rounded-full bg-card p-1.5 shadow-sm">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-4 text-center text-sm font-bold">{it.qty}</span>
                <button onClick={() => cart.setQty(it.id, it.qty + 1)} className="rounded-full bg-card p-1.5 shadow-sm">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="w-14 text-right text-sm font-bold">{fmtINR(ep(it.size) * it.qty)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivery slot</h2>
        <div className="grid grid-cols-2 gap-2">
          {(["round_1", "round_2"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`rounded-2xl border p-3 text-left transition ${
                window === w ? "border-primary bg-primary/5" : "border-border bg-card"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {w === "round_1" ? "Round 1" : "Round 2"}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold">
                <Clock className="h-3.5 w-3.5" /> {WINDOW_LABEL[meal][w]}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="px-4 pt-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
            <Clock className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order for </span>
              <span className="text-sm font-semibold">{formatDate(date)}</span>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-2xl border border-border bg-card p-3">
            <MapPin className="mt-0.5 h-4 w-4 text-primary" />
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deliver to</div>
              <div className="text-sm">{profile?.address || <span className="text-destructive">Add address in Profile</span>}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pt-4">
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <Row label="Subtotal" value={fmtINR(total)} />
          <Row label="Delivery" value="Free" />
          <div className="my-2 border-t border-dashed border-border" />
          <Row label={<span className="font-bold">Total</span>} value={<span className="font-bold">{fmtINR(total)}</span>} />
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Wallet balance</span>
            <span className={enough ? "font-semibold text-success" : "font-semibold text-destructive"}>
              {fmtINR(balance)}
            </span>
          </div>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-16 z-30" style={{ maxWidth: 480, marginInline: "auto" }}>
        <div className="border-t border-border bg-background px-4 py-3">
          <Button onClick={place} disabled={busy || !open || profileLoading} size="lg" className="h-12 w-full bg-gradient-primary text-base shadow-glow">
            {open ? `Place order · ${fmtINR(total)}` : "Cutoff passed"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CutoffBanner({ meal, date }: { meal: "breakfast" | "lunch" | "dinner"; date: Date }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const cutoff = computeCutoff(meal, date);
  const ms = cutoff.getTime() - now.getTime();
  if (ms < 0) {
    return (
      <div className="mx-4 mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
        Cutoff has passed — pick a different meal or date.
      </div>
    );
  }
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const label = hrs > 0 ? `${hrs}h ${rem}m left` : `${rem}m left`;
  const urgent = mins < 60;
  return (
    <div className={`mx-4 mt-3 flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm ${urgent ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-accent/40 text-foreground"}`}>
      <Clock className="h-4 w-4" />
      <span className="font-semibold">{label}</span>
      <span className="text-xs opacity-70">to order this meal</span>
    </div>
  );
}

function computeCutoff(meal: "breakfast" | "lunch" | "dinner", date: Date): Date {
  const mid = istMidnight(date).getTime();
  if (meal === "breakfast") return new Date(mid -  60_000);    // 23:59 IST prev night
  if (meal === "lunch")     return new Date(mid + 36_000_000); // 10:00 IST
  return                          new Date(mid + 54_000_000);  // 15:00 IST
}
