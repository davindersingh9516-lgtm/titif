import { createLazyFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtINR, MEAL_LABEL, type MealType } from "@/lib/meals";

type KitchenRow = { meal_type: MealType; size: string; orders: number };
import {
  ScrollText, Users, Bike, IndianRupee, Truck, CheckCircle2,
  AlertTriangle, Wallet, Clock, RefreshCw, ChefHat, Bell, Repeat2,
  ArrowRight, CircleCheck, CircleAlert,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
} from "recharts";

export const Route = createLazyFileRoute("/admin/")({
  component: Dashboard,
});

type Kpis = {
  orders_today: number; revenue_today: number; pending: number;
  out_for_delivery: number; delivered_today: number; cancelled_today: number;
  failed_today: number; riders_online: number; riders_active: number;
  customers_total: number; recharges_today: number; refunds_today: number;
};

function Dashboard() {
  const qc = useQueryClient();
  const [range, setRange] = useState<7 | 14 | 30>(14);

  const { data: kpis } = useQuery({
    queryKey: ["admin-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_kpis");
      if (error) throw error;
      return data as unknown as Kpis;
    },
    refetchInterval: 30_000,
  });

  const { data: series } = useQuery({
    queryKey: ["admin-series", range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_daily_series", { p_days: range });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        day: new Date(r.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      }));
    },
  });

  const { data: mix } = useQuery({
    queryKey: ["admin-mix", range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_meal_mix", { p_days: range });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        meal: MEAL_LABEL[r.meal_type as MealType],
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      }));
    },
  });

  const { data: top } = useQuery({
    queryKey: ["admin-top", range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_top_customers", { p_days: range, p_limit: 6 });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: riders } = useQuery({
    queryKey: ["admin-rider-perf", range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_rider_performance", { p_days: range });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: kitchen } = useQuery({
    queryKey: ["today-meal-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("today_meal_summary" as any);
      if (error) throw error;
      return (data ?? []) as KitchenRow[];
    },
    refetchInterval: 30_000,
  });

  const { data: actionData } = useQuery({
    queryKey: ["admin-action-data"],
    queryFn: async () => {
      const todayIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const dateStr = todayIST.toISOString().slice(0, 10);
      const [subRes, stuckRes, subOrdersRes] = await Promise.all([
        (supabase as any).from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("delivery_date", dateStr).eq("status", "preparing"),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("delivery_date", dateStr).neq("status", "cancelled"),
      ]);
      return {
        activeSubscriptions: subRes.count ?? 0,
        stuckPreparing: stuckRes.count ?? 0,
        todayOrdersTotal: subOrdersRes.count ?? 0,
        todayDate: dateStr,
        currentHourIST: todayIST.getHours(),
      };
    },
    refetchInterval: 60_000,
  });

  // Group kitchen rows by meal type
  const kitchenByMeal = (["breakfast", "lunch", "dinner"] as MealType[]).map((m) => {
    const rows = (kitchen ?? []).filter((r) => r.meal_type === m);
    const total = rows.reduce((s, r) => s + Number(r.orders), 0);
    return { meal: m, rows, total };
  });

  // Realtime: refresh KPIs on order/delivery changes
  useEffect(() => {
    const ch = supabase
      .channel("admin:dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-kpis"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-kpis"] });
      })
      .subscribe((status, err) => {
        if (err) console.warn("[admin:dashboard] realtime error", err);
      });
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Live · refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-2">
          {([7, 14, 30] as const).map((d) => (
            <button key={d}
              onClick={() => setRange(d)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${range === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {d}d
            </button>
          ))}
          <button onClick={() => qc.invalidateQueries()} className="rounded-full bg-muted p-1.5 text-muted-foreground hover:bg-muted/80">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Today's action checklist */}
      <TodayActions actionData={actionData} kpis={kpis} />

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!kpis ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16 mt-2" />
            </Card>
          ))
        ) : (
          <>
            <Kpi label="Orders today" value={kpis.orders_today} icon={ScrollText} tone="primary" />
            <Kpi label="Revenue today" value={fmtINR(Number(kpis.revenue_today))} icon={IndianRupee} tone="success" />
            <Kpi label="In kitchen" value={kpis.pending} icon={Clock} tone="warn" />
            <Kpi label="Out for delivery" value={kpis.out_for_delivery} icon={Truck} tone="primary" />
            <Kpi label="Delivered" value={kpis.delivered_today} icon={CheckCircle2} tone="success" />
            <Kpi label="Cancelled / failed" value={Number(kpis.cancelled_today) + Number(kpis.failed_today)} icon={AlertTriangle} tone="danger" />
            <Kpi label="Riders online" value={`${kpis.riders_online} / ${kpis.riders_active}`} icon={Bike} tone="primary" />
            <Kpi label="Recharges today" value={fmtINR(Number(kpis.recharges_today))} icon={Wallet} tone="success" sub={`Refunds ${fmtINR(Number(kpis.refunds_today))}`} />
          </>
        )}
      </div>

      {/* Kitchen prep — today's orders by meal + size */}
      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChefHat className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold">Aaj ki Kitchen — kya kitna banana hai</div>
          </div>
          <div className="text-[11px] text-muted-foreground">Live · auto refresh 30s</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {kitchenByMeal.map(({ meal, rows, total }) => {
            const mealColors: Record<string, string> = {
              breakfast: "border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20",
              lunch: "border-primary/20 bg-primary/5",
              dinner: "border-indigo-300/40 bg-indigo-50/50 dark:bg-indigo-950/20",
            };
            const headColors: Record<string, string> = {
              breakfast: "text-amber-700 dark:text-amber-400",
              lunch: "text-primary",
              dinner: "text-indigo-600 dark:text-indigo-400",
            };
            return (
              <div key={meal} className={`rounded-xl border p-3 ${mealColors[meal]}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-xs font-bold uppercase tracking-wider ${headColors[meal]}`}>
                    {MEAL_LABEL[meal]}
                  </div>
                  <div className="text-2xl font-bold">{total}</div>
                </div>
                {total === 0 ? (
                  <div className="text-xs text-muted-foreground">No orders yet</div>
                ) : (
                  <div className="space-y-1">
                    {rows.map((r) => (
                      <div key={r.size} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-muted-foreground">{r.size} thali</span>
                        <span className="font-bold">{r.orders} orders</span>
                      </div>
                    ))}
                    {rows.length === 1 && rows[0].size === "fixed" && (
                      <div className="text-xs text-muted-foreground mt-1">Fixed size only</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Trend chart */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Orders & revenue</div>
            <div className="text-xs text-muted-foreground">Last {range} days</div>
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <AreaChart data={series ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                formatter={(v: number, n) => n === "revenue" ? fmtINR(v) : v} />
              <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" strokeWidth={2} />
              <Area type="monotone" dataKey="orders" stroke="hsl(var(--muted-foreground))" fill="transparent" strokeWidth={1.5} strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Meal mix */}
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">Meal mix · {range}d</div>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <BarChart data={mix ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="meal" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                <Bar dataKey="orders" radius={[8, 8, 0, 0]}>
                  {(mix ?? []).map((_, i) => (
                    <Cell key={i} fill={["hsl(var(--primary))", "hsl(var(--accent-foreground))", "hsl(var(--chart-3, var(--primary)))"][i % 3]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top customers */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Top customers</div>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            {(top ?? []).length === 0 && <div className="text-xs text-muted-foreground">No data yet.</div>}
            {(top ?? []).map((c: any, i: number) => (
              <div key={c.user_id ?? i} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.full_name || "Customer"}</div>
                  <div className="text-[11px] text-muted-foreground">{c.phone || "—"} · {c.orders} orders</div>
                </div>
                <div className="text-sm font-semibold">{fmtINR(Number(c.spend))}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Rider performance */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Rider performance · {range}d</div>
          <Bike className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-2">Rider</th><th>Status</th><th className="text-right">Delivered</th><th className="text-right">Failed</th><th className="text-right">Avg time</th></tr>
            </thead>
            <tbody>
              {(riders ?? []).map((r: any) => (
                <tr key={r.rider_id} className="border-t border-border">
                  <td className="py-2 font-medium">{r.name}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.online ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                      {r.online ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td className="text-right">{r.delivered}</td>
                  <td className="text-right">{r.failed}</td>
                  <td className="text-right">{Number(r.avg_minutes ?? 0).toFixed(0)} min</td>
                </tr>
              ))}
              {(!riders || riders.length === 0) && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">No rider activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Meal delivery windows (IST hours) ────────────────────────────────────────
const MEAL_WINDOWS = {
  // cutoff=0 for breakfast: order cutoff was previous night (23:59), so from midnight kitchen is already prepping
  breakfast: { label: "Breakfast", cutoff: 0,  start: 7,  end: 9,  color: "amber" },
  lunch:     { label: "Lunch",     cutoff: 10, start: 12, end: 14, color: "green" },
  dinner:    { label: "Dinner",    cutoff: 15, start: 19, end: 21, color: "indigo" },
} as const;

function TodayActions({ actionData, kpis }: { actionData: any; kpis: Kpis | undefined }) {
  if (!actionData) return null;

  const h = actionData.currentHourIST;

  type AlertItem = { id: string; level: "action" | "info" | "ok"; text: string; sub?: string; href?: string };
  const alerts: AlertItem[] = [];

  // Subscription order generation reminder — before breakfast cutoff
  if (actionData.activeSubscriptions > 0 && actionData.todayOrdersTotal < actionData.activeSubscriptions) {
    alerts.push({
      id: "sub-gen",
      level: "action",
      text: `Generate today's subscription orders`,
      sub: `${actionData.activeSubscriptions} active plans · ${actionData.todayOrdersTotal} orders created so far`,
      href: "/admin/subscriptions",
    });
  } else if (actionData.activeSubscriptions > 0) {
    alerts.push({
      id: "sub-ok",
      level: "ok",
      text: `Subscription orders generated`,
      sub: `${actionData.todayOrdersTotal} orders for ${actionData.activeSubscriptions} active plans`,
    });
  }

  // Meal window alerts
  for (const [meal, w] of Object.entries(MEAL_WINDOWS)) {
    if (h < w.cutoff) {
      const cutoffLabel = meal === "breakfast" ? "11:59 PM previous night" : `${w.cutoff}:00`;
      alerts.push({ id: `cutoff-${meal}`, level: "info", text: `${w.label} cutoff at ${cutoffLabel}`, sub: `Delivery ${w.start}:00–${w.end}:00 · confirm kitchen count` });
    } else if (h >= w.cutoff && h < w.start) {
      alerts.push({ id: `prep-${meal}`, level: "action", text: `${w.label} in kitchen now`, sub: `Delivery starts ${w.start}:00 · mark orders "preparing"` });
    } else if (h >= w.start && h <= w.end) {
      alerts.push({ id: `del-${meal}`, level: "action", text: `${w.label} delivery window open`, sub: `${w.start}:00–${w.end}:00 · track riders and deliveries` });
    }
  }

  // Stuck in preparing
  if (actionData.stuckPreparing > 0) {
    alerts.push({
      id: "stuck",
      level: "action",
      text: `${actionData.stuckPreparing} order${actionData.stuckPreparing > 1 ? "s" : ""} stuck in "Preparing"`,
      sub: "Advance to out-for-delivery or check with kitchen",
      href: "/admin/orders",
    });
  }

  if (alerts.length === 0) return null;

  const levelStyle: Record<string, string> = {
    action: "border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/25",
    info:   "border-border bg-card",
    ok:     "border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-950/20",
  };
  const iconStyle: Record<string, { cls: string; Icon: any }> = {
    action: { cls: "text-amber-600 dark:text-amber-400", Icon: CircleAlert },
    info:   { cls: "text-muted-foreground", Icon: Clock },
    ok:     { cls: "text-emerald-600 dark:text-emerald-400", Icon: CircleCheck },
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Today's actions</div>
        <div className="ml-auto text-[11px] text-muted-foreground">refreshes 1 min</div>
      </div>
      <div className="space-y-2">
        {alerts.map((a) => {
          const { cls, Icon } = iconStyle[a.level];
          const inner = (
            <div className={`flex items-start gap-3 rounded-xl border p-3 ${levelStyle[a.level]} ${a.href ? "cursor-pointer transition hover:brightness-95" : ""}`}>
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug">{a.text}</div>
                {a.sub && <div className="text-[11px] text-muted-foreground mt-0.5">{a.sub}</div>}
              </div>
              {a.href && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          );
          return a.href ? (
            <Link key={a.id} to={a.href as any}>{inner}</Link>
          ) : (
            <div key={a.id}>{inner}</div>
          );
        })}
      </div>
    </Card>
  );
}

function Kpi({ label, value, icon: Icon, tone, sub }: { label: string; value: any; icon: any; tone: "primary" | "success" | "warn" | "danger"; sub?: string }) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600",
    warn: "bg-amber-500/10 text-amber-600",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`rounded-lg p-1.5 ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
