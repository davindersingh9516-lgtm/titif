import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, MapPin, Package, CheckCircle2, AlertTriangle } from "lucide-react";
import { MEAL_LABEL, WINDOW_LABEL, type MealType } from "@/lib/meals";

export const Route = createFileRoute("/rider/")({
  component: RiderHome,
});

const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  picked_up: "Picked up",
  en_route: "En route",
  arrived: "Arrived",
  delivered: "Delivered",
  failed: "Failed",
};

function RiderHome() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: rider } = useQuery({
    enabled: !!user,
    queryKey: ["rider-self", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("riders").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: deliveries } = useQuery({
    enabled: !!rider?.id,
    queryKey: ["rider-deliveries", rider?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("deliveries")
        .select("*, orders:order_id(*, profiles:user_id(full_name, phone), order_items(name, qty, size))")
        .eq("rider_id", rider!.id)
        .order("status", { ascending: true })
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!rider?.id) return;
    const ch = supabase
      .channel(`rider:${rider.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries", filter: `rider_id=eq.${rider.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["rider-deliveries"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rider?.id, qc]);

  if (!rider) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your rider profile isn't set up yet. Ask an admin to create your rider record.
      </div>
    );
  }

  const active = deliveries?.filter((d) => !["delivered", "failed"].includes(d.status)) ?? [];
  const done = deliveries?.filter((d) => ["delivered", "failed"].includes(d.status)) ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={Package} label="Active" value={active.length} tone="primary" />
        <Stat icon={CheckCircle2} label="Done" value={done.filter((d) => d.status === "delivered").length} tone="success" />
        <Stat icon={AlertTriangle} label="Failed" value={done.filter((d) => d.status === "failed").length} tone="warn" />
      </div>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Active route</h2>
        {active.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No active deliveries. Stay online — new ones will appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((d, i) => <DeliveryRow key={d.id} d={d} index={i + 1} />)}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Completed today</h2>
          <div className="space-y-2">
            {done.slice(0, 10).map((d) => <DeliveryRow key={d.id} d={d} compact />)}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: any) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600",
    warn: "bg-amber-500/10 text-amber-600",
  };
  return (
    <Card className="p-3">
      <div className={`mb-2 inline-flex rounded-lg p-1.5 ${tones[tone]}`}><Icon className="h-4 w-4" /></div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </Card>
  );
}

function DeliveryRow({ d, index, compact }: { d: any; index?: number; compact?: boolean }) {
  const o = d.orders;
  return (
    <Link to="/rider/d/$id" params={{ id: d.id }}>
      <Card className="flex items-center gap-3 p-3 transition active:scale-[0.99]">
        {index !== undefined && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {index}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{o?.profiles?.full_name || "Customer"}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">{STATUS_LABEL[d.status]}</Badge>
          </div>
          {!compact && (
            <>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {MEAL_LABEL[o?.meal_type as MealType]} · {WINDOW_LABEL[o?.meal_type as MealType]?.[o?.delivery_window as "round_1" | "round_2"]}
              </div>
              <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="line-clamp-1">{o?.address}</span>
              </div>
            </>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Card>
    </Link>
  );
}
