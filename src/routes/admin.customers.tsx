import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { fmtINR, isoDate, toIST } from "@/lib/meals";
import {
  ChevronLeft, ChevronRight, Search, ArrowUpRight, ArrowDownLeft,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/admin/customers")({ component: CustomersAdmin });

const PAGE_SIZE = 50;
type Period = "today" | "week" | "month" | "year" | "custom";

function periodRange(period: Period, cf: string, ct: string) {
  const now = new Date();
  const ist = toIST(now);
  const today = isoDate(now);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (period) {
    case "today": return { from: today, to: today };
    case "week":  return { from: isoDate(new Date(now.getTime() - 6 * 86_400_000)), to: today };
    case "month": return { from: `${y}-${pad(m + 1)}-01`, to: today };
    case "year":  return { from: `${y}-01-01`, to: today };
    default:      return { from: cf, to: ct };
  }
}

function walletColor(bal: number) {
  if (bal < 100) return "text-red-600";
  if (bal < 300) return "text-amber-600";
  return "text-emerald-600";
}

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

// ── Main page ────────────────────────────────────────────────────────────────

function CustomersAdmin() {
  const [page, setPage]               = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch]           = useState("");
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // Paginated customer list
  const { data, isLoading } = useQuery({
    queryKey: ["customers-v2", page, search],
    queryFn: async () => {
      let q = (supabase as any)
        .from("profiles")
        .select("id, full_name, phone, created_at, wallets(balance)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        q = q.or(`full_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);
      }

      const { data: rows, count, error } = await q;
      if (error) throw error;
      return { customers: (rows ?? []) as any[], total: count ?? 0 };
    },
    refetchInterval: 60_000,
    placeholderData: (prev: any) => prev,
  });

  // Active subscriber IDs — small query, used for badge
  const { data: subIds } = useQuery({
    queryKey: ["active-sub-ids"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("user_id")
        .eq("status", "active");
      return new Set<string>((data ?? []).map((s: any) => s.user_id as string));
    },
    staleTime: 120_000,
  });

  const customers   = data?.customers ?? [];
  const totalPages  = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const totalCount  = data?.total ?? 0;

  const doSearch = () => { setSearch(searchInput); setPage(0); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(0); };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Customers
            {totalCount > 0 && (
              <span className="ml-2 text-base font-normal text-muted-foreground">({totalCount})</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">Click any row to view full order & wallet history</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 h-9 text-sm w-64"
              placeholder="Search name or phone…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
            />
          </div>
          <Button size="sm" onClick={doSearch}>Search</Button>
          {search && <Button size="sm" variant="ghost" onClick={clearSearch}>Clear</Button>}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-right">Wallet</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-5" /></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-32" /></div></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                  <td className="px-4 py-3"></td>
                </tr>
              ))}

              {!isLoading && customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {search ? `No customers found for "${search}"` : "No customers yet"}
                  </td>
                </tr>
              )}

              {customers.map((c: any, i: number) => {
                const bal   = Number(c.wallets?.balance ?? 0);
                const isSub = subIds?.has(c.id) ?? false;
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedUser(c)}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground/60 tabular-nums">
                      {page * PAGE_SIZE + i + 1}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0 select-none">
                          {initials(c.full_name)}
                        </div>
                        <div>
                          <div className="font-medium leading-tight">{c.full_name || "Unnamed"}</div>
                          {isSub && (
                            <span className="text-[10px] font-semibold bg-green-500/10 text-green-700 dark:text-green-400 rounded-full px-1.5 py-0.5">
                              Subscribed
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>

                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${walletColor(bal)}`}>
                      {fmtINR(bal)}
                    </td>

                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(c.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
                      })}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-primary font-medium">View →</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs tabular-nums">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* User detail dialog */}
      {selectedUser && (
        <UserDetailDialog user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}

// ── User detail dialog ───────────────────────────────────────────────────────

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week",  label: "Week" },
  { id: "month", label: "Month" },
  { id: "year",  label: "Year" },
  { id: "custom", label: "Custom" },
];

const ORDER_STATUS_CLASS: Record<string, string> = {
  delivered:        "bg-green-500/15 text-green-700 dark:text-green-400",
  out_for_delivery: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  preparing:        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  placed:           "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  cancelled:        "bg-red-500/15 text-red-600 dark:text-red-400",
};

function UserDetailDialog({ user, onClose }: { user: any; onClose: () => void }) {
  const [period, setPeriod]       = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(isoDate(new Date()));
  const [customTo, setCustomTo]   = useState(isoDate(new Date()));

  const { from, to } = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["user-orders-detail", user.id, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, meal_type, delivery_date, status, total, order_items(name, qty, size)")
        .eq("user_id", user.id)
        .gte("delivery_date", from)
        .lte("delivery_date", to)
        .order("delivery_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: txns = [], isLoading: txnsLoading } = useQuery({
    queryKey: ["user-txns-detail", user.id, from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wallet_transactions")
        .select("id, type, amount, description, created_at")
        .eq("user_id", user.id)
        .gte("created_at", from + "T00:00:00+05:30")
        .lte("created_at", to + "T23:59:59+05:30")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: subscription } = useQuery({
    queryKey: ["user-sub-detail", user.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscriptions")
        .select("status, meal_types, size, start_date, end_date")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  const stats = useMemo(() => {
    const spent   = txns.filter((t: any) => t.type === "order_debit").reduce((s: number, t: any) => s + Math.abs(Number(t.amount)), 0);
    const topups  = txns.filter((t: any) => t.type === "topup").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const delivered = orders.filter((o: any) => o.status === "delivered").length;
    const avgOrder  = orders.length > 0 ? spent / orders.length : 0;
    return { spent, topups, orderCount: orders.length, delivered, avgOrder };
  }, [orders, txns]);

  const bal = Number(user.wallets?.balance ?? 0);

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-base font-bold text-primary shrink-0">
              {initials(user.full_name)}
            </div>
            <div className="min-w-0">
              <div className="truncate">{user.full_name || "Unnamed Customer"}</div>
              <div className="text-sm font-normal text-muted-foreground">{user.phone || "No phone"}</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* Wallet + subscription summary */}
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 flex-1 min-w-[140px]">
              <Wallet className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Wallet balance</div>
                <div className={`text-xl font-bold tabular-nums ${walletColor(bal)}`}>{fmtINR(bal)}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 flex-1 min-w-[140px]">
              <div>
                <div className="text-xs text-muted-foreground">Joined</div>
                <div className="text-sm font-semibold">
                  {new Date(user.created_at).toLocaleDateString("en-IN", {
                    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata",
                  })}
                </div>
              </div>
            </div>

            {subscription && (
              <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 flex-1 min-w-[140px]">
                <div>
                  <div className="text-xs text-muted-foreground">Subscription</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <Badge variant="outline" className={
                      subscription.status === "active" ? "border-green-400 text-green-700" :
                      subscription.status === "paused" ? "border-amber-400 text-amber-700" :
                      "border-muted text-muted-foreground"
                    }>
                      {subscription.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground capitalize">{subscription.size}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Period selector */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {PERIODS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    period === p.id
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card hover:bg-muted"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="flex items-center gap-3 pt-1">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">From</div>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">To</div>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs" />
                </div>
              </div>
            )}
          </div>

          {/* Period stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Orders",     value: String(stats.orderCount) },
              { label: "Delivered",  value: String(stats.delivered), cls: "text-emerald-600" },
              { label: "Spent",      value: fmtINR(stats.spent), cls: "text-orange-600" },
              { label: "Top-ups",    value: fmtINR(stats.topups), cls: "text-green-600" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border bg-card p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                <div className={`text-lg font-bold tabular-nums mt-0.5 ${s.cls ?? ""}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Orders table */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Orders ({orders.length})
              </span>
              {stats.orderCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Avg {fmtINR(Math.round(stats.avgOrder))} / order
                </span>
              )}
            </div>

            {ordersLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                No orders in this period
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Meal</th>
                      <th className="px-3 py-2 text-left">Items</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">₹</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map((o: any) => (
                      <tr key={o.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {new Date(o.delivery_date + "T00:00:00+05:30").toLocaleDateString("en-IN", {
                            day: "numeric", month: "short", timeZone: "Asia/Kolkata",
                          })}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize font-medium">{o.meal_type}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[150px] truncate">
                          {(o.order_items as any[])?.map((i: any) => `${i.qty}×${i.name}`).join(", ") || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${ORDER_STATUS_CLASS[o.status] ?? "bg-muted"}`}>
                            {o.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-xs">
                          {fmtINR(Number(o.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Transactions */}
          <div className="pb-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transactions ({txns.length})
            </div>
            {txnsLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
              </div>
            ) : txns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                No transactions in this period
              </div>
            ) : (
              <div className="rounded-xl border divide-y overflow-hidden">
                {txns.map((t: any) => {
                  const isCredit = Number(t.amount) > 0;
                  const dt = new Date(t.created_at);
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20">
                      <div className={`rounded-full p-1.5 shrink-0 ${isCredit ? "bg-green-500/10" : "bg-orange-500/10"}`}>
                        {isCredit
                          ? <ArrowUpRight className="h-3 w-3 text-green-600" />
                          : <ArrowDownLeft className="h-3 w-3 text-orange-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium capitalize">{(t.type as string).replace(/_/g, " ")}</div>
                        {t.description && <div className="text-[10px] text-muted-foreground truncate">{t.description}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-bold tabular-nums ${isCredit ? "text-green-600" : "text-orange-600"}`}>
                          {isCredit ? "+" : ""}{fmtINR(Math.abs(Number(t.amount)))}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
                          {" · "}
                          {dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
