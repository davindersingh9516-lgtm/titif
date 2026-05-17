import { createLazyFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  useAdminKpis, useDailySeries, useMealMix, useTopCustomers,
  useRiderPerformance, useGrowthKpis, useSupportKpis, useAnalyticsRealtime,
} from "@/hooks/use-analytics";
import { fmtINR } from "@/lib/meals";
import { TrendingUp, Users, Bike, IndianRupee, Activity } from "lucide-react";

export const Route = createLazyFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

const MEAL_COLORS: Record<string, string> = {
  breakfast: "hsl(var(--chart-1, 24 95% 53%))",
  lunch: "hsl(var(--chart-2, 142 71% 45%))",
  dinner: "hsl(var(--chart-3, 262 83% 58%))",
};

function Kpi({ label, value, icon: Icon, hint }: { label: string; value: string | number; icon: any; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
          {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
    </Card>
  );
}

function AnalyticsPage() {
  useAnalyticsRealtime();
  const [range, setRange] = useState<7 | 14 | 30>(14);

  const { data: kpis } = useAdminKpis();
  const { data: series } = useDailySeries(range);
  const { data: mealMix } = useMealMix(range);
  const { data: top } = useTopCustomers(30, 8);
  const { data: riders } = useRiderPerformance(7);
  const { data: growth } = useGrowthKpis();
  const { data: support } = useSupportKpis();

  return (
    <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" /> Analytics
            </h1>
            <p className="text-sm text-muted-foreground">Realtime operational and business intelligence</p>
          </div>
          <div className="flex rounded-lg border p-0.5">
            {([7, 14, 30] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-medium rounded-md ${
                  range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}>{r}d</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Kpi label="Orders today" value={kpis?.orders_today ?? 0} icon={TrendingUp} />
          <Kpi label="Revenue today" value={fmtINR(kpis?.revenue_today ?? 0)} icon={IndianRupee} />
          <Kpi label="Out for delivery" value={kpis?.out_for_delivery ?? 0} icon={Bike} hint={`${kpis?.riders_online ?? 0} riders online`} />
          <Kpi label="Delivered" value={kpis?.delivered_today ?? 0} icon={Activity} />
          <Kpi label="Recharges" value={fmtINR(kpis?.recharges_today ?? 0)} icon={IndianRupee} />
          <Kpi label="Customers" value={kpis?.customers_total ?? 0} icon={Users} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Revenue trend</h2>
              <Badge variant="outline">{range}d</Badge>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series ?? []}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: any) => fmtINR(Number(v))} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-3">Orders per day</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={series ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="font-semibold mb-3">Meal mix ({range}d)</h2>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={mealMix ?? []} dataKey="orders" nameKey="meal_type" innerRadius={50} outerRadius={90} paddingAngle={3}>
                  {(mealMix ?? []).map((m) => (
                    <Cell key={m.meal_type} fill={MEAL_COLORS[m.meal_type] ?? "hsl(var(--primary))"} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-3">Rider performance (7d)</h2>
            <div className="space-y-2 max-h-[240px] overflow-auto">
              {(riders ?? []).map(r => (
                <div key={r.rider_id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${r.online ? "bg-green-500" : "bg-muted-foreground"}`} />
                    <span className="font-medium">{r.name}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span><b className="text-foreground">{r.delivered}</b> delivered</span>
                    <span><b className="text-destructive">{r.failed}</b> failed</span>
                    <span><b className="text-foreground">{Math.round(r.avg_minutes)}</b>m avg</span>
                  </div>
                </div>
              ))}
              {(!riders || riders.length === 0) && (
                <div className="text-center py-6 text-sm text-muted-foreground">No rider activity yet</div>
              )}
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4 lg:col-span-2">
            <h2 className="font-semibold mb-3">Top customers (30d)</h2>
            <div className="space-y-2 max-h-[260px] overflow-auto">
              {(top ?? []).map((c, i) => (
                <div key={c.user_id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground w-5">#{i + 1}</span>
                    <div>
                      <div className="font-medium">{c.full_name ?? "Customer"}</div>
                      <div className="text-xs text-muted-foreground">{c.phone ?? "—"}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{fmtINR(c.spend)}</div>
                    <div className="text-xs text-muted-foreground">{c.orders} orders</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="font-semibold mb-3 text-sm">Growth (30d)</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Active" value={growth?.active_30d ?? 0} />
                <Stat label="Inactive 14d" value={growth?.inactive_14d ?? 0} />
                <Stat label="Referrals" value={growth?.referrals_total ?? 0} />
                <Stat label="Rewarded" value={growth?.referrals_rewarded ?? 0} />
                <Stat label="★ Food" value={(growth?.rating_avg_food_30d ?? 0) || "—"} />
                <Stat label="★ Rider" value={(growth?.rating_avg_rider_30d ?? 0) || "—"} />
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="font-semibold mb-3 text-sm">Support</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Open" value={support?.open ?? 0} />
                <Stat label="Urgent" value={support?.urgent_open ?? 0} />
                <Stat label="Resolved 7d" value={support?.resolved_7d ?? 0} />
                <Stat label="Avg hrs" value={support?.avg_resolution_hours ?? 0} />
              </div>
            </Card>
          </div>
        </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
