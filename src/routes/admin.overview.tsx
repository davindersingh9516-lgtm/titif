import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmtINR } from "@/lib/meals";
import { TrendingUp, Users, Wallet, ScrollText, ShieldCheck, Bike, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin/overview")({
  component: AdminOverview,
});

type Overview = {
  gmv_30d: number; gmv_lifetime: number;
  orders_30d: number; orders_lifetime: number;
  customers_total: number; customers_active_30d: number;
  wallet_balance_total: number; recharges_30d: number; refunds_30d: number;
  admins: number; riders: number;
};

function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("super_overview");
      if (error) throw error;
      return data as unknown as Overview;
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform overview</h1>
        <p className="text-sm text-muted-foreground">Business health & growth · refreshes every minute</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Big label="GMV (30d)"              value={fmtINR(Number(data?.gmv_30d ?? 0))}         icon={TrendingUp} />
        <Big label="Orders (30d)"           value={data?.orders_30d ?? "—"}                     icon={ScrollText} />
        <Big label="Active customers (30d)" value={data?.customers_active_30d ?? "—"}           icon={Users} />
        <Big label="Wallet float"           value={fmtINR(Number(data?.wallet_balance_total ?? 0))} icon={Wallet} />
        <Big label="Recharges (30d)"        value={fmtINR(Number(data?.recharges_30d ?? 0))}    icon={RefreshCw} />
        <Big label="Refunds (30d)"          value={fmtINR(Number(data?.refunds_30d ?? 0))}      icon={RefreshCw} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Mini label="Lifetime GMV"      value={fmtINR(Number(data?.gmv_lifetime ?? 0))} />
        <Mini label="Lifetime orders"   value={data?.orders_lifetime ?? "—"} />
        <Mini label="Total customers"   value={data?.customers_total ?? "—"} />
        <Mini label="Admins"            value={data?.admins ?? "—"}            icon={ShieldCheck} />
        <Mini label="Active riders"     value={data?.riders ?? "—"}            icon={Bike} />
        <Mini label="Status"            value={isLoading ? "…" : "Live"} />
      </div>
    </div>
  );
}

function Big({ label, value, icon: Icon }: any) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </Card>
  );
}

function Mini({ label, value, icon: Icon }: any) {
  return (
    <Card className="flex items-center justify-between p-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-semibold">{value}</div>
      </div>
      {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
    </Card>
  );
}
