import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmtINR, isoDate, toIST } from "@/lib/meals";
import {
  ArrowDownLeft, ArrowUpRight, RefreshCw,
  TrendingUp, Wallet, Receipt, IndianRupee, CalendarDays, BadgeIndianRupee,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({ meta: [{ title: "Transactions — Admin" }] }),
  component: TransactionsPage,
});

type TxType = "topup" | "order_debit" | "refund" | "adjustment";
type FilterType = "all" | TxType;
type DatePreset = "today" | "week" | "month" | "custom";

const PAGE_SIZE = 50;

interface WalletTx {
  id: string;
  user_id: string;
  type: TxType;
  amount: number;
  balance_after: number;
  description: string | null;
  reference_id: string | null;
  created_at: string;
  profiles: { full_name: string | null; phone: string | null } | null;
}

function getPresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const ist = toIST(now);
  const today = isoDate(now);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (preset) {
    case "today": return { from: today, to: today };
    case "week":  return { from: isoDate(new Date(now.getTime() - 6 * 86_400_000)), to: today };
    case "month": return { from: `${y}-${pad(m + 1)}-01`, to: today };
    default:      return { from: today, to: today };
  }
}

const TYPE_LABEL: Record<TxType, string> = {
  topup:       "Top-up",
  order_debit: "Order",
  refund:      "Refund",
  adjustment:  "Adjustment",
};

const TYPE_COLOR: Record<TxType, string> = {
  topup:       "bg-green-500/10 text-green-700 dark:text-green-400",
  order_debit: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  refund:      "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  adjustment:  "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

function TransactionsPage() {
  const [preset, setPreset]     = useState<DatePreset>("today");
  const [customFrom, setFrom]   = useState(isoDate(new Date()));
  const [customTo, setTo]       = useState(isoDate(new Date()));
  const [typeFilter, setType]   = useState<FilterType>("all");
  const [page, setPage]         = useState(0);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  // ── Summary query: ALL records for the period (light: type + amount only) ──
  // Used for the footer totals — not limited by pagination.
  const { data: summaryRows = [] } = useQuery({
    queryKey: ["admin-txn-summary", from, to, typeFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("wallet_transactions")
        .select("type, amount")
        .gte("created_at", from + "T00:00:00+05:30")
        .lte("created_at", to + "T23:59:59+05:30");
      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { type: string; amount: number }[];
    },
  });

  // ── Paginated display query ──
  const { data: txnData, isLoading, refetch } = useQuery({
    queryKey: ["admin-transactions", from, to, typeFilter, page],
    queryFn: async () => {
      let q = (supabase as any)
        .from("wallet_transactions")
        .select("id, user_id, type, amount, balance_after, description, reference_id, created_at", { count: "exact" })
        .gte("created_at", from + "T00:00:00+05:30")
        .lte("created_at", to + "T23:59:59+05:30")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (typeFilter !== "all") q = q.eq("type", typeFilter);

      const { data, count, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Omit<WalletTx, "profiles">[];

      // Resolve profiles (two-step: PostgREST can't join through auth.users)
      const uids = [...new Set(rows.map(r => r.user_id))];
      let profileMap: Record<string, { full_name: string | null; phone: string | null }> = {};
      if (uids.length > 0) {
        const { data: profiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name, phone")
          .in("id", uids);
        for (const p of profiles ?? []) profileMap[p.id] = p;
      }

      return {
        txns:  rows.map(r => ({ ...r, profiles: profileMap[r.user_id] ?? null })) as WalletTx[],
        total: count ?? 0,
      };
    },
    placeholderData: (prev: any) => prev,
  });

  const txns       = txnData?.txns ?? [];
  const totalCount = txnData?.total ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Footer summary from ALL records in period (not just current page)
  const summary = useMemo(() => {
    const topupTotal  = summaryRows.filter(t => t.type === "topup").reduce((s, t) => s + Number(t.amount), 0);
    const debitTotal  = summaryRows.filter(t => t.type === "order_debit").reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const refundTotal = summaryRows.filter(t => t.type === "refund").reduce((s, t) => s + Number(t.amount), 0);
    const netRevenue  = debitTotal - refundTotal;
    return { topupTotal, debitTotal, refundTotal, netRevenue, count: summaryRows.length };
  }, [summaryRows]);

  const PRESETS: { id: DatePreset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week",  label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "custom", label: "Custom" },
  ];

  const TYPE_TABS: { id: FilterType; label: string }[] = [
    { id: "all",         label: "All" },
    { id: "topup",       label: "Top-ups" },
    { id: "order_debit", label: "Orders" },
    { id: "refund",      label: "Refunds" },
    { id: "adjustment",  label: "Adjustments" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">All wallet transactions across all users</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted transition"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Summary cards — always from ALL records in period */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-green-500/10 p-2 text-green-600"><TrendingUp className="h-4 w-4" /></span>
            <div>
              <div className="text-xs text-muted-foreground">Total Top-ups</div>
              <div className="text-xl font-bold text-green-600">{fmtINR(summary.topupTotal)}</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-orange-500/10 p-2 text-orange-600"><Receipt className="h-4 w-4" /></span>
            <div>
              <div className="text-xs text-muted-foreground">Gross Order Revenue</div>
              <div className="text-xl font-bold text-orange-600">{fmtINR(summary.debitTotal)}</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-blue-500/10 p-2 text-blue-600"><Wallet className="h-4 w-4" /></span>
            <div>
              <div className="text-xs text-muted-foreground">Refunds Issued</div>
              <div className="text-xl font-bold text-blue-600">{fmtINR(summary.refundTotal)}</div>
            </div>
          </div>
        </Card>
        <Card className={`p-4 ${summary.netRevenue >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-400/30 bg-red-500/5"}`}>
          <div className="flex items-center gap-3">
            <span className={`rounded-lg p-2 ${summary.netRevenue >= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
              <BadgeIndianRupee className="h-4 w-4" />
            </span>
            <div>
              <div className="text-xs text-muted-foreground">Net Revenue</div>
              <div className={`text-xl font-bold ${summary.netRevenue >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmtINR(summary.netRevenue)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {summary.count} txns total
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Date filter */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Date range</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => { setPreset(p.id); setPage(0); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                preset === p.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card hover:bg-muted"
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
              <input type="date" value={customFrom} onChange={e => { setFrom(e.target.value); setPage(0); }}
                className="mt-0.5 block rounded-lg border border-border bg-card px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" value={customTo} onChange={e => { setTo(e.target.value); setPage(0); }}
                className="mt-0.5 block rounded-lg border border-border bg-card px-3 py-1.5 text-sm" />
            </div>
          </div>
        )}
      </Card>

      {/* Type filter */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setType(t.id); setPage(0); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              typeFilter === t.id
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card hover:bg-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading transactions…
          </div>
        ) : txns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <IndianRupee className="h-8 w-8 opacity-30" />
            <span className="text-sm">No transactions found for this period</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-left">Date & Time</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Balance After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {txns.map(tx => {
                  const isCredit = Number(tx.amount) > 0;
                  const dt = new Date(tx.created_at);
                  const dateStr = dt.toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
                  });
                  const timeStr = dt.toLocaleTimeString("en-IN", {
                    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
                  });
                  return (
                    <tr key={tx.id} className="hover:bg-muted/30 transition">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">{dateStr}</div>
                        <div className="text-xs text-muted-foreground">{timeStr}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{tx.profiles?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {tx.profiles?.phone ?? tx.user_id.slice(0, 8) + "…"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLOR[tx.type]}`}>
                          {isCredit ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                          {TYPE_LABEL[tx.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                        {tx.description ?? "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${isCredit ? "text-green-600" : "text-red-500"}`}>
                        {isCredit ? "+" : ""}{fmtINR(Math.abs(Number(tx.amount)))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmtINR(Number(tx.balance_after))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between bg-muted/10">
            <span className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs tabular-nums">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* All-period summary footer — always shows totals for the FULL date range */}
        {summary.count > 0 && (
          <div className="border-t border-border bg-muted/20 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Period total: <span className="font-semibold text-foreground">{summary.count}</span> transactions
            </span>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span>Top-ups: <span className="font-semibold text-green-600">{fmtINR(summary.topupTotal)}</span></span>
              <span>Gross orders: <span className="font-semibold text-orange-600">{fmtINR(summary.debitTotal)}</span></span>
              <span>Refunds: <span className="font-semibold text-blue-600">−{fmtINR(summary.refundTotal)}</span></span>
              <span className={`font-bold text-sm ${summary.netRevenue >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                Net: {fmtINR(summary.netRevenue)}
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
