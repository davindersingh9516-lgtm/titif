import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmtINR, isoDate, toIST } from "@/lib/meals";
import { IndianRupee, TrendingUp, Receipt, Wallet, FileText, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/admin/finance")({
  head: () => ({ meta: [{ title: "Finance & Tax — Admin" }] }),
  component: FinancePage,
});

// India GST rate for restaurant/food delivery (5% — no ITC)
const GST_RATE = 0.05;

type DatePreset = "today" | "week" | "month" | "custom";

function getPresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const ist  = toIST(now);
  const today = isoDate(now);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (preset) {
    case "today": return { from: today, to: today };
    case "week": {
      const d7 = new Date(now.getTime() - 6 * 86_400_000);
      return { from: isoDate(d7), to: today };
    }
    case "month": return { from: `${y}-${pad(m + 1)}-01`, to: today };
    default: return { from: today, to: today };
  }
}

function StatCard({ label, value, sub, color = "text-foreground", icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon: typeof IndianRupee;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
        <span className="rounded-xl bg-muted p-2.5 text-muted-foreground"><Icon className="h-4 w-4" /></span>
      </div>
    </Card>
  );
}

function FinancePage() {
  const [preset, setPreset]   = useState<DatePreset>("month");
  const [customFrom, setFrom] = useState(isoDate(new Date()));
  const [customTo, setTo]     = useState(isoDate(new Date()));

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["finance-txns", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wallet_transactions")
        .select("type, amount, created_at")
        .gte("created_at", from + "T00:00:00+05:30")
        .lte("created_at", to + "T23:59:59+05:30");
      if (error) throw error;
      return (data ?? []) as { type: string; amount: number; created_at: string }[];
    },
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["finance-orders", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("total, status, meal_type, created_at")
        .gte("created_at", from + "T00:00:00+05:30")
        .lte("created_at", to + "T23:59:59+05:30")
        .neq("status", "cancelled");
      if (error) throw error;
      return (data ?? []) as { total: number; status: string; meal_type: string; created_at: string }[];
    },
  });

  const stats = useMemo(() => {
    const grossRevenue = txns
      .filter((t) => t.type === "order_debit")
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    const refunds = txns
      .filter((t) => t.type === "refund")
      .reduce((s, t) => s + Number(t.amount), 0);

    const topups = txns
      .filter((t) => t.type === "topup")
      .reduce((s, t) => s + Number(t.amount), 0);

    const netRevenue = grossRevenue - refunds;

    // GST inclusive calculation (price includes 5% GST)
    // Net = Price / 1.05, GST = Price - Net
    const taxableValue = netRevenue / (1 + GST_RATE);
    const gstAmount    = netRevenue - taxableValue;
    const cgst         = gstAmount / 2;
    const sgst         = gstAmount / 2;

    const orderCount    = orders.length;
    const deliveredCount = orders.filter((o) => o.status === "delivered").length;
    const avgOrderValue = orderCount > 0 ? grossRevenue / orderCount : 0;

    // Meal breakdown
    const byMeal = orders.reduce<Record<string, number>>((acc, o) => {
      acc[o.meal_type] = (acc[o.meal_type] ?? 0) + Number(o.total);
      return acc;
    }, {});

    return {
      grossRevenue, refunds, netRevenue, topups,
      taxableValue, gstAmount, cgst, sgst,
      orderCount, deliveredCount, avgOrderValue, byMeal,
    };
  }, [txns, orders]);

  const PRESETS: { id: DatePreset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week",  label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "custom", label: "Custom" },
  ];

  const loading = isLoading || ordersLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance & Tax</h1>
        <p className="text-sm text-muted-foreground">Revenue, GST, and earnings summary</p>
      </div>

      {/* Date filter */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Period</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                preset === p.id ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-3 pt-1">
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <input type="date" value={customFrom} onChange={(e) => setFrom(e.target.value)}
                className="mt-0.5 block rounded-lg border border-border bg-card px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" value={customTo} onChange={(e) => setTo(e.target.value)}
                className="mt-0.5 block rounded-lg border border-border bg-card px-3 py-1.5 text-sm" />
            </div>
          </div>
        )}
      </Card>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Revenue summary */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Revenue</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Receipt}       label="Gross Revenue"  value={fmtINR(stats.grossRevenue)} sub="All order debits"          color="text-orange-600" />
              <StatCard icon={Wallet}        label="Refunds"        value={fmtINR(stats.refunds)}      sub="Cancelled order refunds"   color="text-blue-600" />
              <StatCard icon={TrendingUp}    label="Net Revenue"    value={fmtINR(stats.netRevenue)}   sub="Gross − Refunds"           color={stats.netRevenue >= 0 ? "text-emerald-600" : "text-red-600"} />
              <StatCard icon={IndianRupee}   label="Wallet Top-ups" value={fmtINR(stats.topups)}       sub="Cash collected via UPI"    color="text-green-600" />
            </div>
          </div>

          {/* GST breakdown */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              GST Breakdown <span className="text-xs font-normal normal-case">(5% — GST inclusive, no ITC)</span>
            </h2>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-left">Component</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">Net Revenue (incl. GST)</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtINR(stats.netRevenue)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-3 text-muted-foreground">Taxable value (excl. GST)</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtINR(Math.round(stats.taxableValue))}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">Base</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-3 text-muted-foreground">CGST</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtINR(Math.round(stats.cgst))}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">2.5%</td>
                  </tr>
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-3 text-muted-foreground">SGST</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtINR(Math.round(stats.sgst))}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">2.5%</td>
                  </tr>
                  <tr className="bg-muted/30 font-bold">
                    <td className="px-4 py-3">Total GST payable</td>
                    <td className="px-4 py-3 text-right tabular-nums text-primary">{fmtINR(Math.round(stats.gstAmount))}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">5%</td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-border bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                GST applies only if annual turnover exceeds ₹20 lakhs. Consult your CA for exact compliance requirements.
              </div>
            </Card>
          </div>

          {/* Orders summary */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Orders</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard icon={FileText}  label="Total Orders"   value={String(stats.orderCount)}    sub="Placed (excl. cancelled)" />
              <StatCard icon={TrendingUp} label="Avg Order Value" value={fmtINR(Math.round(stats.avgOrderValue))} sub="Gross ÷ order count" />
              <StatCard icon={Receipt}   label="Delivered"      value={String(stats.deliveredCount)} sub="Status = delivered" />
            </div>
          </div>

          {/* Revenue by meal */}
          {Object.keys(stats.byMeal).length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Revenue by Meal</h2>
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 text-left">Meal</th>
                      <th className="px-4 py-3 text-right">Revenue</th>
                      <th className="px-4 py-3 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Object.entries(stats.byMeal)
                      .sort(([, a], [, b]) => b - a)
                      .map(([meal, rev]) => (
                        <tr key={meal} className="hover:bg-muted/20">
                          <td className="px-4 py-3 capitalize font-medium">{meal}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtINR(rev)}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {stats.grossRevenue > 0 ? Math.round((rev / stats.grossRevenue) * 100) : 0}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
