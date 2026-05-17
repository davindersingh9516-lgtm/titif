import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/customer/AppHeader";
import { Button } from "@/components/ui/button";
import { fmtINR, isBeforeCutoff, MEAL_LABEL, WINDOW_LABEL, formatDate, type MealType } from "@/lib/meals";
import { CheckCircle2, ChefHat, Bike, MapPin, XCircle, Clock } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { toast } from "sonner";
import { RatingPrompt } from "@/components/customer/RatingPrompt";
import { useConfirm } from "@/hooks/use-confirm";

const LiveTrackCard = lazy(() =>
  import("@/components/customer/LiveTrackCard").then((m) => ({ default: m.LiveTrackCard })),
);

export const Route = createFileRoute("/app/track/$id")({
  component: TrackPage,
});

const STEPS = [
  { key: "placed", label: "Order placed", icon: CheckCircle2 },
  { key: "preparing", label: "Being prepared", icon: ChefHat },
  { key: "out_for_delivery", label: "On the way", icon: Bike },
  { key: "delivered", label: "Delivered", icon: MapPin },
] as const;

function TrackPage() {
  const { id } = Route.useParams();
  const confirmDialog = useConfirm();

  const { data: order, refetch } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("*, order_items(*), riders:orders_rider_id_fkey(name, phone, current_lat, current_lng)")
        .eq("id", id)
        .maybeSingle();
      return data;
    },
  });

  // Realtime updates
  useEffect(() => {
    const ch = supabase
      .channel(`order:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `id=eq.${id}` }, () => refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, refetch]);

  if (!order) return <><AppHeader title="Tracking" back="/app/orders" /><div className="p-6 text-muted-foreground">Loading…</div></>;

  const currentIdx = STEPS.findIndex((s) => s.key === order.status);
  // Cancel allowed only if still within the ordering cutoff window
  const withinCutoff = isBeforeCutoff(order.meal_type as MealType, new Date(order.delivery_date));

  return (
    <div className="pb-8">
      <AppHeader title="Track order" back="/app/orders" />

      <div className="px-4 pt-4">
        <Suspense fallback={<div className="flex h-48 items-center justify-center text-muted-foreground">Loading map…</div>}>
          <LiveTrackCard
            riderId={order.rider_id}
            destLat={order.lat}
            destLng={order.lng}
            destAddress={order.address}
            status={order.status as string}
          />
        </Suspense>
      </div>

      <div className="px-4 pt-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{MEAL_LABEL[order.meal_type as MealType]}</div>
              <div className="font-semibold">{WINDOW_LABEL[order.meal_type as MealType][order.delivery_window as "round_1" | "round_2"]}</div>
              <div className="mt-1 text-sm font-medium text-primary">
                {formatDate(new Date(order.delivery_date + "T00:00:00+05:30"))}
              </div>
            </div>
            <div className="rounded-xl bg-accent px-3 py-1.5 text-center">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Delivery OTP</div>
              <div className="text-lg font-bold tracking-widest">{order.delivery_otp}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <ol className="space-y-4">
            {STEPS.map((s, i) => {
              const active = i <= currentIdx && order.status !== "cancelled";
              const Icon = s.icon;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full ${active ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className={`text-sm ${active ? "font-semibold" : "text-muted-foreground"}`}>{s.label}</div>
                </li>
              );
            })}
          </ol>
        </div>

        {order.riders && order.rider_id && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <div className="rounded-xl bg-accent p-2.5">
              <Bike className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Your rider</div>
              <div className="font-semibold">{(order.riders as any).name}</div>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Order summary</div>
          <div className="mt-2 space-y-1 text-sm">
            {(order.order_items as any[])?.map((i) => (
              <div key={i.id} className="flex justify-between">
                <span>{i.qty}× {i.name}</span>
                <span>{fmtINR(Number(i.price) * i.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-dashed border-border pt-3 text-sm font-bold">
            <span>Total paid</span>
            <span>{fmtINR(Number(order.total))}</span>
          </div>
        </div>

        {order.status === "placed" && withinCutoff && (
          <Button
            variant="outline"
            className="mt-4 w-full gap-2 text-destructive"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Cancel this order?",
                body: "Your wallet will be refunded instantly.",
                confirmLabel: "Yes, cancel",
                variant: "destructive",
              });
              if (!ok) return;
              const { error } = await supabase.rpc("cancel_order_with_refund", { p_order_id: id, p_reason: "Customer cancelled" });
              if (error) {
                if (error.message.includes("cutoff_passed")) toast.error("Cutoff passed — no cancellation allowed");
                else toast.error(error.message);
              } else {
                toast.success("Order cancelled · refund credited to wallet");
                refetch();
              }
            }}
          >
            <XCircle className="h-4 w-4" /> Cancel order
          </Button>
        )}

        {order.status === "placed" && !withinCutoff && (
          <div className="mt-4 rounded-2xl border border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 p-4">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Clock className="h-4 w-4 shrink-0" />
              <div className="text-sm font-semibold">Order window closed</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Ordering cutoff has passed — cancellation and refund are not available for this order.
            </div>
          </div>
        )}

        {order.status === "delivered" && <RatingPrompt orderId={id} />}

        {order.status === "cancelled" && (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            This order was cancelled. Refund of {fmtINR(Number(order.total))} added to your wallet.
          </div>
        )}
      </div>
    </div>
  );
}
