import { createLazyFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";
import {
  IndianRupee, TrendingUp, TrendingDown, Receipt, Wallet,
  Info, Download, CalendarDays, ShieldCheck, AlertCircle,
} from "lucide-react";
import { isoDate, toIST, fmtINR } from "@/lib/meals";

export const Route = createLazyFileRoute("/admin/finance")({
  component: FinancePage,
});

// ── Date helpers ────────────────────────────────────────────────────────────

type Preset = "today" | "7d" | "30d" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const ist = toIST(now);
  const today = isoDate(now);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-indexed

  const d = (n: number) => isoDate(new Date(now.getTime() - n * 86_400_000));

  switch (preset) {
    case "today":       return { from: today, to: today };
    case "7d":          return { from: d(6), to: today };
    case "30d":         return { from: d(29), to: today };
    case "this_month":  return { from: `${y}-${pad(m + 1)}-01`, to: today };
    case "last_month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      const last = new Date(ly, lm + 1, 0).getDate();
      return { from: `${ly}-${pad(lm + 1)}-01`, to: `${ly}-${pad(lm + 1)}-${pad(last)}` };
    }
    case "this_quarter": {
      const q = Math.floor(m / 3);
      return { from: `${y}-${pad(q * 3 + 1)}-01`, to: today };
    }
    case "this_year":   return { from: `${y}-04-01`, to: today }; // Indian FY: Apr–Mar
    default:            return { from: today, to: today };
  }
}

function pad(n: number) { return String(n).padStart(2, "0"); }

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today",        label: "Today" },
  { key: "7d",           label: "7 Days" },
  { key: "30d",          label: "30 Days" },
  { key: "this_month",   label: "This Month" },
  { key: "last_month",   label: "Last Month" },
  { key: "this_quarter", label: "This Quarter" },
  { key: "this_year",    label: "FY (Apr–Mar)" },
  { key: "custom",       label: "Custom" },
];

const MEAL_COLORS: Record<string, string> = {
  breakfast: "#f59e0b",
  lunch:     "#22c55e",
  dinner:    "#8b5cf6",
};

// ── Simple CSV export ────────────────────────────────────────────────────────

function exportCSV(data: any, from: string, to: string) {
  if (!data) return;
  const rows: string[][] = [
    ["Date Range", `${from} to ${to}`],
    [],
    ["REVENUE SUMMARY"],
    ["GMV", data.revenue.gmv],
    ["Refunds", data.revenue.refunds],
    ["Net Revenue", data.revenue.net],
    ["Orders", data.revenue.orders],
    ["Cancelled", data.revenue.cancelled],
    ["Avg Order Value", data.revenue.avg_order],
    [],
    ["GST COMPUTATION (SAC 9963 @ 5%, GST-Inclusive)"],
    ["Taxable Value", data.gst.taxable_value],
    ["CGST @ 2.5%", data.gst.cgst],
    ["SGST @ 2.5%", data.gst.sgst],
    ["Total GST", data.gst.total_gst],
    [],
    ["INCOME TAX (Sec 44AD Presumptive @ 6%)"],
    ["Gross Receipts (net of GST)", data.income_tax.taxable_receipts],
    ["Presumptive Income (6%)", data.income_tax.presumptive_income],
    [],
    ["CASH FLOW"],
    ["Wallet Top-ups", data.cash_flow.topups],
    ["Refunds Paid", data.cash_flow.refunds_paid],
    ["Net Cash In", data.cash_flow.net_cash_in],
    ["Wallet Float (Liability)", data.cash_flow.wallet_float],
    [],
    ["MEAL BREAKDOWN"],
    ["Meal", "Orders", "Revenue", "Share %"],
    ...(data.meal_breakdown ?? []).map((m: any) => [m.meal_type, m.orders, m.revenue, `${m.share_pct}%`]),
    [],
    ["DAILY SERIES"],
    ["Date", "Orders", "Revenue"],
    ...(data.daily_series ?? []).map((d: any) => [d.day, d.orders, d.revenue]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tiffin-finance-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ─────────────────────────────────────────────────────────────────────

function FinancePage() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState(isoDate(new Date()));
  const [customTo,   setCustomTo]   = useState(isoDate(new Date()));
  const [chartMode, setChartMode] = useState<"daily" | "weekly">("daily");

  const { from, to } = useMemo(() =>
    preset === "custom" ? { from: customFrom, to: customTo } : getPresetRange(preset),
    [preset, customFrom, customTo],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["finance-report", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_finance_report", {
        p_from: from, p_to: to,
      });
      if (error) throw error;
      return data as unknown as FinanceReport;
    },
    staleTime: 2 * 60_000,
  });

  const chartData = useMemo(() => {
    if (!data) return [];
    const series = chartMode === "daily" ? data.daily_series : data.weekly_series;
    return (series ?? []).map((r: any) => ({
      label: chartMode === "daily"
        ? new Date(r.day  + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short" })
        : new Date(r.week + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      revenue: Number(r.revenue),
      orders:  Number(r.orders),
    }));
  }, [data, chartMode]);

  const mealData = useMemo(() =>
    (data?.meal_breakdown ?? []).map((m: any) => ({
      name:     m.meal_type.charAt(0).toUpperCase() + m.meal_type.slice(1),
      value:    Number(m.revenue),
      orders:   m.orders,
      share:    m.share_pct,
      avgOrder: Number(m.avg_order),
      color:    MEAL_COLORS[m.meal_type] ?? "#94a3b8",
    })),
    [data],
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <IndianRupee className="h-6 w-6" /> Finance & Tax
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            P&amp;L · GST (SAC 9963) · Section 44AD — Indian food service laws
          </p>
        </div>
        <button
          onClick={() => exportCSV(data, from, to)}
          disabled={!data}
          className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* ── Date range picker ── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                preset === p.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs" />
            </div>
          )}
        </div>
        {data && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {new Date(from + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}
            {" — "}
            {new Date(to   + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}
            <span className="font-medium text-foreground">({data.period.days} days)</span>
          </div>
        )}
      </Card>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {(error as any)?.message ?? "Failed to load finance data"}
        </div>
      )}

      {/* ── Revenue KPIs ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Gross Revenue (GMV)"
          value={data ? fmtINR(Number(data.revenue.gmv)) : "—"}
          sub={data ? `${data.revenue.orders} orders` : undefined}
          icon={TrendingUp} color="text-primary" loading={isLoading}
        />
        <KpiCard
          label="Net Revenue"
          value={data ? fmtINR(Number(data.revenue.net)) : "—"}
          sub={data ? `After ₹${Number(data.revenue.refunds).toFixed(0)} refunds` : undefined}
          icon={IndianRupee} color="text-green-600" loading={isLoading}
        />
        <KpiCard
          label="Avg Order Value"
          value={data ? fmtINR(Number(data.revenue.avg_order)) : "—"}
          sub={data ? `Daily avg ${fmtINR(Number(data.revenue.daily_avg))}` : undefined}
          icon={Receipt} color="text-amber-600" loading={isLoading}
        />
        <KpiCard
          label="Cancellation Rate"
          value={data ? `${data.revenue.cancellation_rate}%` : "—"}
          sub={data ? `${data.revenue.cancelled} cancelled · ${data.revenue.refund_rate}% refund rate` : undefined}
          icon={TrendingDown} color="text-destructive" loading={isLoading}
        />
      </div>

      {/* ── Revenue trend chart ── */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Revenue Trend</h2>
          <div className="flex rounded-lg border p-0.5">
            {(["daily", "weekly"] as const).map((m) => (
              <button key={m} onClick={() => setChartMode(m)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition ${
                  chartMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}>{m}</button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="label" fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
            <YAxis fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              formatter={(v: any, name: string) =>
                name === "revenue" ? [fmtINR(Number(v)), "Revenue"] : [v, "Orders"]
              }
            />
            <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))"
              fill="url(#revGrad)" strokeWidth={2} name="revenue" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* ── GST + Income Tax side by side ── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* GST Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-bold text-base">GST Computation</h2>
              <p className="text-xs text-muted-foreground mt-0.5">SAC 9963 · Food Services · 5% (No ITC)</p>
            </div>
            <Badge className="bg-blue-500/15 text-blue-700 border-blue-300/50 text-[10px]">
              GST-Inclusive Pricing
            </Badge>
          </div>

          <div className="space-y-2 text-sm">
            <TaxRow label="Gross Revenue Collected" value={data ? fmtINR(Number(data.revenue.gmv)) : "—"} />
            <TaxRow label="Less: Refunds" value={data ? `−${fmtINR(Number(data.revenue.refunds))}` : "—"} muted />
            <div className="border-t border-dashed border-border my-1" />
            <TaxRow label="Net Taxable Revenue" value={data ? fmtINR(Number(data.gst.taxable_value)) : "—"} bold />
            <TaxRow label="CGST @ 2.5%" value={data ? fmtINR(Number(data.gst.cgst)) : "—"} accent="text-blue-600" />
            <TaxRow label="SGST @ 2.5%" value={data ? fmtINR(Number(data.gst.sgst)) : "—"} accent="text-blue-600" />
            <div className="border-t border-border my-1" />
            <TaxRow label="Total GST Payable" value={data ? fmtINR(Number(data.gst.total_gst)) : "—"} bold highlight="bg-blue-50 dark:bg-blue-950/30" />
          </div>

          <div className="rounded-lg border border-blue-200/60 bg-blue-50/50 dark:bg-blue-950/20 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-400">
              <Info className="h-3.5 w-3.5 shrink-0" /> GST Rules — Food Services
            </div>
            <p>· 5% GST applies (CGST 2.5% + SGST 2.5%) on food delivery services.</p>
            <p>· <b>No ITC</b> allowed at 5% rate — input tax cannot be claimed.</p>
            <p>· Mandatory registration when <b>annual turnover &gt; ₹20 Lakhs</b>.</p>
            <p>· File <b>GSTR-1</b> (outward supplies) + <b>GSTR-3B</b> monthly.</p>
          </div>
        </Card>

        {/* Income Tax Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-bold text-base">Income Tax</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Section 44AD · Presumptive Taxation</p>
            </div>
            <Badge className="bg-purple-500/15 text-purple-700 border-purple-300/50 text-[10px]">
              Digital @ 6%
            </Badge>
          </div>

          <div className="space-y-2 text-sm">
            <TaxRow label="Net Revenue" value={data ? fmtINR(Number(data.revenue.net)) : "—"} />
            <TaxRow label="Less: GST Output" value={data ? `−${fmtINR(Number(data.gst.total_gst))}` : "—"} muted />
            <div className="border-t border-dashed border-border my-1" />
            <TaxRow label="Gross Receipts (net of GST)" value={data ? fmtINR(Number(data.income_tax.taxable_receipts)) : "—"} bold />
            <TaxRow label="Presumptive Rate (digital/UPI)" value="6%" />
            <div className="border-t border-border my-1" />
            <TaxRow label="Presumptive Income (Sec 44AD)" value={data ? fmtINR(Number(data.income_tax.presumptive_income)) : "—"} bold highlight="bg-purple-50 dark:bg-purple-950/30" accent="text-purple-700" />
          </div>

          <div className="rounded-lg border border-purple-200/60 bg-purple-50/50 dark:bg-purple-950/20 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-400">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Section 44AD — Key Rules
            </div>
            <p>· Eligible if gross receipts &lt; <b>₹2 Crore</b> per financial year.</p>
            <p>· Since all payments are UPI/digital: deemed profit = <b>6%</b> of receipts.</p>
            <p>· No need to maintain detailed books under presumptive scheme.</p>
            <p>· Advance tax: <b>single installment by 15 March</b> (not quarterly).</p>
            <p>· Rider payments &gt; ₹30K: TDS @ 1% u/s <b>194C</b> may apply.</p>
          </div>
        </Card>
      </div>

      {/* ── Cash Flow ── */}
      <Card className="p-5">
        <h2 className="font-bold text-base mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Cash Flow
          <span className="text-xs font-normal text-muted-foreground ml-1">— money in/out of the platform</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <CashKpi label="Wallet Top-ups" value={data ? fmtINR(Number(data.cash_flow.topups)) : "—"}
            sub={data ? `${data.cash_flow.topup_count} transactions` : undefined} color="text-green-600" icon="↑" />
          <CashKpi label="UPI Collected" value={data ? fmtINR(Number(data.cash_flow.upi_collected)) : "—"}
            sub={data ? `${data.cash_flow.upi_success_count} payments` : undefined} color="text-green-600" icon="↑" />
          <CashKpi label="Refunds Paid Out" value={data ? fmtINR(Number(data.cash_flow.refunds_paid)) : "—"}
            sub={data ? `${data.revenue.refund_count} refunds` : undefined} color="text-destructive" icon="↓" />
          <CashKpi label="Wallet Float" value={data ? fmtINR(Number(data.cash_flow.wallet_float)) : "—"}
            sub="Customer liability — not income" color="text-amber-600" icon="⊙" />
        </div>
        <div className="mt-3 rounded-lg border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-amber-700 dark:text-amber-400">⚠ Wallet Float</span> — ₹{data ? Number(data.cash_flow.wallet_float).toFixed(0) : "—"} is customer money collected but not yet converted to orders. This is a <b>liability</b> on your balance sheet, not revenue.
        </div>
      </Card>

      {/* ── Meal breakdown ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Revenue by Meal</h2>
          {mealData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={mealData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                  {mealData.map((m) => <Cell key={m.name} fill={m.color} />)}
                </Pie>
                <Legend formatter={(v) => <span className="text-xs capitalize">{v}</span>} />
                <Tooltip formatter={(v: any) => fmtINR(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data</div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-3">Meal Breakdown</h2>
          <div className="space-y-2">
            {mealData.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No orders in this period</p>
            )}
            {mealData.map((m) => (
              <div key={m.name} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                    <span className="font-semibold text-sm">{m.name}</span>
                  </div>
                  <span className="text-sm font-bold">{fmtINR(m.value)}</span>
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>{m.orders} orders · avg {fmtINR(m.avgOrder)}</span>
                    <span className="font-semibold">{m.share}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${m.share}%`, background: m.color }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {mealData.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-medium">Total Orders</span>
                <span className="font-bold">{data?.revenue.orders ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-muted-foreground font-medium">Total Revenue</span>
                <span className="font-bold text-primary">{data ? fmtINR(Number(data.revenue.gmv)) : "—"}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Quarterly GST calendar ── */}
      <Card className="p-5">
        <h2 className="font-bold text-base mb-1">GST Filing Calendar</h2>
        <p className="text-xs text-muted-foreground mb-4">Indian financial year · Quarterly due dates</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { q: "Q1", period: "Apr – Jun", gstr1: "11 Jul", gstr3b: "20 Jul" },
            { q: "Q2", period: "Jul – Sep", gstr1: "11 Oct", gstr3b: "20 Oct" },
            { q: "Q3", period: "Oct – Dec", gstr1: "11 Jan", gstr3b: "20 Jan" },
            { q: "Q4", period: "Jan – Mar", gstr1: "11 Apr", gstr3b: "20 Apr" },
          ].map((q) => (
            <div key={q.q} className="rounded-xl border border-border p-3 text-sm">
              <div className="font-bold text-primary">{q.q}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{q.period}</div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GSTR-1</span>
                  <span className="font-medium">{q.gstr1}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GSTR-3B</span>
                  <span className="font-medium">{q.gstr3b}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          * Monthly filers: GSTR-1 by 11th, GSTR-3B by 20th of following month.
          Under QRMP scheme (turnover &lt; ₹5 Cr): quarterly GSTR-1, monthly IFF option available.
        </p>
      </Card>

    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color, loading }: {
  label: string; value: string; sub?: string;
  icon: any; color: string; loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground leading-tight">{label}</div>
          <div className={`mt-1 text-xl font-bold tabular-nums ${loading ? "animate-pulse text-muted-foreground" : ""}`}>
            {loading ? "···" : value}
          </div>
          {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
        </div>
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${color}`} />
      </div>
    </Card>
  );
}

function TaxRow({ label, value, bold, muted, accent, highlight }: {
  label: string; value: string;
  bold?: boolean; muted?: boolean; accent?: string; highlight?: string;
}) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${highlight ?? ""}`}>
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold text-base" : "font-medium"} ${accent ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

function CashKpi({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-sm font-bold ${color}`}>{icon}</span>
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type FinanceReport = {
  period:   { from: string; to: string; days: number };
  revenue:  { gmv: number; refunds: number; net: number; orders: number; cancelled: number; refund_count: number; avg_order: number; cancellation_rate: number; refund_rate: number; daily_avg: number };
  gst:      { taxable_value: number; cgst: number; sgst: number; total_gst: number; rate_pct: number };
  income_tax: { taxable_receipts: number; presumptive_income: number };
  cash_flow:  { topups: number; topup_count: number; upi_collected: number; upi_pending: number; upi_failed: number; upi_success_count: number; upi_pending_count: number; refunds_paid: number; wallet_float: number; net_cash_in: number };
  meal_breakdown: { meal_type: string; orders: number; revenue: number; share_pct: number; avg_order: number }[];
  daily_series:   { day: string; orders: number; revenue: number }[];
  weekly_series:  { week: string; orders: number; revenue: number }[];
};
