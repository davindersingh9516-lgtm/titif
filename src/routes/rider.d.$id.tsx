import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ChevronLeft, MapPin, Phone, Navigation2, Package, Truck, MapPinned, KeyRound, X } from "lucide-react";
import { fmtINR, MEAL_LABEL, WINDOW_LABEL, type MealType } from "@/lib/meals";

export const Route = createFileRoute("/rider/d/$id")({
  component: DeliveryDetail,
});

function DeliveryDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [otp, setOtp] = useState("");
  const [showFail, setShowFail] = useState(false);
  const [reason, setReason] = useState("");

  const { data: d, isLoading } = useQuery({
    queryKey: ["rider-delivery", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select("*, orders:order_id(*, profiles:user_id(full_name, phone), order_items(name, qty, size, price))")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (status: "picked_up" | "en_route" | "arrived") => {
      const pos = await new Promise<GeolocationPosition | null>((res) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
        navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { timeout: 5000 });
      });
      const { error } = await supabase.rpc("rider_update_delivery", {
        p_delivery_id: id,
        p_status: status,
        p_lat: pos?.coords.latitude ?? undefined,
        p_lng: pos?.coords.longitude ?? undefined,
        p_reason: undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-delivery", id] });
      qc.invalidateQueries({ queryKey: ["rider-deliveries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("verify_delivery_otp", { p_delivery_id: id, p_otp: otp });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Delivered ✓");
      qc.invalidateQueries({ queryKey: ["rider-deliveries"] });
      nav({ to: "/rider" });
    },
    onError: (e: any) => toast.error(e.message === "invalid_otp" ? "Wrong OTP" : e.message),
  });

  const fail = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("rider_update_delivery", {
        p_delivery_id: id,
        p_status: "failed",
        p_lat: undefined,
        p_lng: undefined,
        p_reason: reason || "Delivery failed",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reported");
      qc.invalidateQueries({ queryKey: ["rider-deliveries"] });
      nav({ to: "/rider" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !d) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  const o = d.orders as any;
  const mapsUrl = o.lat && o.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`;

  const status = d.status as string;
  const isDone = status === "delivered" || status === "failed";

  return (
    <div className="space-y-4">
      <Link to="/rider" className="-ml-2 inline-flex items-center gap-1 rounded-full p-2 text-sm hover:bg-accent">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground">{MEAL_LABEL[o.meal_type as MealType]} · {WINDOW_LABEL[o.meal_type as MealType][o.delivery_window as "round_1" | "round_2"]}</div>
            <div className="mt-0.5 text-lg font-bold">{o.profiles?.full_name || "Customer"}</div>
          </div>
          <Badge>{status.replace("_", " ")}</Badge>
        </div>
        <div className="mt-3 flex gap-2">
          <a href={`tel:${o.profiles?.phone}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-input bg-background py-2 text-sm font-semibold">
            <Phone className="h-4 w-4" /> Call
          </a>
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground">
            <Navigation2 className="h-4 w-4" /> Navigate
          </a>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="text-sm">{o.address}</div>
        </div>
        {o.notes && <div className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700">Note: {o.notes}</div>}
      </Card>

      <Card className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</div>
        <div className="mt-2 space-y-1.5 text-sm">
          {o.order_items?.map((i: any) => (
            <div key={i.name + i.size} className="flex justify-between">
              <span>{i.qty}× {i.name} <span className="text-xs text-muted-foreground">({i.size})</span></span>
              <span className="text-muted-foreground">{fmtINR(Number(i.price) * i.qty)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t pt-2 text-sm font-semibold">
          <span>Total</span><span>{fmtINR(Number(o.total))}</span>
        </div>
      </Card>

      {!isDone && (
        <div className="space-y-2">
          {status === "assigned" && (
            <ActionBtn icon={Package} onClick={() => updateStatus.mutate("picked_up")} loading={updateStatus.isPending}>
              Confirm pickup
            </ActionBtn>
          )}
          {status === "picked_up" && (
            <ActionBtn icon={Truck} onClick={() => updateStatus.mutate("en_route")} loading={updateStatus.isPending}>
              Start delivery
            </ActionBtn>
          )}
          {status === "en_route" && (
            <ActionBtn icon={MapPinned} onClick={() => updateStatus.mutate("arrived")} loading={updateStatus.isPending}>
              Mark arrived
            </ActionBtn>
          )}

          {status === "arrived" && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="h-4 w-4 text-primary" /> Customer OTP
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Ask the customer for their 4-digit code.</p>
              <div className="mt-3 flex justify-center">
                <InputOTP maxLength={4} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3].map((i) => <InputOTPSlot key={i} index={i} className="h-12 w-12 text-lg" />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                disabled={otp.length !== 4 || verify.isPending}
                onClick={() => verify.mutate()}
                className="mt-4 h-11 w-full"
              >
                Verify & complete
              </Button>
            </Card>
          )}

          {!showFail ? (
            <button onClick={() => setShowFail(true)} className="w-full rounded-xl py-2 text-xs font-medium text-destructive hover:bg-destructive/5">
              Report a problem
            </button>
          ) : (
            <Card className="space-y-2 p-4">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Report problem</span>
                <button onClick={() => setShowFail(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["Customer unreachable", "Wrong address", "OTP failed", "Other"].map((r) => (
                  <button key={r} onClick={() => setReason(r)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${reason === r ? "bg-destructive text-destructive-foreground" : "bg-muted"}`}>
                    {r}
                  </button>
                ))}
              </div>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Add details…" rows={2} />
              <Button variant="destructive" disabled={!reason || fail.isPending} onClick={() => fail.mutate()} className="w-full">
                Mark as failed
              </Button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ icon: Icon, onClick, loading, children }: any) {
  return (
    <Button onClick={onClick} disabled={loading} className="h-12 w-full text-base shadow-glow">
      <Icon className="mr-2 h-5 w-5" /> {children}
    </Button>
  );
}
