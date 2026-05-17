import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtINR, MEAL_LABEL, WINDOW_LABEL, isoDate, toIST, type MealType } from "@/lib/meals";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Search, X } from "lucide-react";
import { useConfirm } from "@/hooks/use-confirm";

export const Route = createFileRoute("/admin/orders")({
  component: OrdersAdmin,
});

const NEXT: Record<string, string | null> = {
  placed: "preparing",
  preparing: "out_for_delivery",
  out_for_delivery: "delivered",
  delivered: null,
  cancelled: null,
};

const STATUS_FILTERS = ["all", "placed", "preparing", "out_for_delivery", "delivered", "cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const MEAL_FILTERS = ["all", "breakfast", "lunch", "dinner"] as const;
type MealFilter = (typeof MEAL_FILTERS)[number];

const PAGE_SIZE = 25;

function todayIST(): string {
  return isoDate(new Date());
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00+05:30");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function formatDateLabel(dateStr: string): string {
  const today = todayIST();
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T00:00:00+05:30").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}

function OrdersAdmin() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const [date, setDate] = useState(todayIST);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("placed");
  const [mealFilter, setMealFilter] = useState<MealFilter>("all");
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [nameSearch, setNameSearch]   = useState("");

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [date, statusFilter, mealFilter, nameSearch]);

  const { data: ordersData, isLoading, error } = useQuery({
    queryKey: ["admin-orders", date, statusFilter, mealFilter, page, nameSearch],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          "*, profiles:orders_user_id_profiles_fkey(full_name, phone), order_items(name, qty, size)",
          { count: "exact" }
        )
        .eq("delivery_date", date)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (mealFilter !== "all")   q = q.eq("meal_type", mealFilter);
      if (nameSearch.trim())      q = (q as any).ilike("profiles.full_name", `%${nameSearch.trim()}%`);

      const { data, count, error } = await q;
      if (error) throw error;
      return { orders: data ?? [], total: count ?? 0 };
    },
  });

  const orders = ordersData?.orders ?? [];
  const totalPages = Math.ceil((ordersData?.total ?? 0) / PAGE_SIZE);

  const { data: riders } = useQuery({
    queryKey: ["riders-active"],
    queryFn: async () => {
      const { data } = await supabase.from("riders").select("id, name, online").eq("active", true).order("name");
      return data ?? [];
    },
  });

  const assign = async (orderId: string, riderId: string) => {
    const { error } = await supabase.rpc("assign_delivery", { p_order_id: orderId, p_rider_id: riderId });
    if (error) { toast.error(error.message); return; }
    toast.success("Rider assigned");
    qc.invalidateQueries({ queryKey: ["admin-orders"] });
  };

  // Realtime: refetch on any order change
  useEffect(() => {
    const ch = supabase
      .channel("admin:orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const DELIVERY_HOURS: Record<string, [number, number]> = {
    breakfast: [7, 11],
    lunch:     [11, 15],
    dinner:    [18, 22],
  };

  const advance = async (id: string, status: string, mealType?: string) => {
    if (status === "delivered" && mealType) {
      const nowH = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
      const [from, to] = DELIVERY_HOURS[mealType] ?? [0, 24];
      if (nowH < from || nowH >= to) {
        const ok = await confirmDialog({
          title: "Wrong delivery time",
          body: `${MEAL_LABEL[mealType as MealType]} delivery window is ${from}:00–${to}:00 IST. It is currently ${nowH}:xx. Are you sure you want to mark this delivered now?`,
          confirmLabel: "Yes, mark delivered",
          variant: "destructive",
        });
        if (!ok) return;
      }
    }
    const { error } = await supabase.from("orders").update({ status: status as any }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("order_events").insert({ order_id: id, status: status as any, actor_id: user?.id ?? null });
    toast.success(`Marked ${status.replace(/_/g, " ")}`);
    qc.invalidateQueries({ queryKey: ["admin-orders"] });
  };

  const cancel = async (id: string) => {
    const ok = await confirmDialog({
      title: "Cancel this order?",
      body: "The wallet will be refunded immediately.",
      confirmLabel: "Yes, cancel",
      variant: "destructive",
    });
    if (!ok) return;
    const { error } = await supabase.rpc("cancel_order_with_refund", { p_order_id: id, p_reason: "Admin cancellation" });
    if (error) { toast.error(error.message); return; }
    toast.success("Cancelled & refunded");
    qc.invalidateQueries({ queryKey: ["admin-orders"] });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Live · auto-updates
        </span>
      </div>

      {/* Toolbar card */}
      <div className="mt-4 rounded-xl border border-border bg-card shadow-sm overflow-hidden">

        {/* ── Date navigation ── */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <button
            onClick={() => setDate((d) => addDays(d, -1))}
            className="rounded-lg p-1.5 hover:bg-muted transition text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex flex-1 items-center justify-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold">
              {date === todayIST()
                ? `Today · ${new Date(date + "T00:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`
                : new Date(date + "T00:00:00+05:30").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="w-[130px] rounded-lg border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
            />
            {date !== todayIST() && (
              <button
                onClick={() => setDate(todayIST())}
                className="rounded-lg bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition whitespace-nowrap"
              >
                → Today
              </button>
            )}
          </div>

          <button
            onClick={() => setDate((d) => addDays(d, 1))}
            className="rounded-lg p-1.5 hover:bg-muted transition text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* ── Customer name search ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              placeholder="Search customer…"
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && setNameSearch(searchInput)}
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchInput && (
              <button
                onClick={() => { setSearchInput(""); setNameSearch(""); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {searchInput !== nameSearch && (
            <button
              onClick={() => setNameSearch(searchInput)}
              className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition"
            >
              Search
            </button>
          )}
          {nameSearch && (
            <span className="text-xs text-muted-foreground">
              Showing: <span className="font-semibold text-foreground">"{nameSearch}"</span>
            </span>
          )}
        </div>

        {/* ── Meal + Status filters ── */}
        <div className="divide-y divide-border">
          {/* Meal row */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Meal</span>
            <div className="flex flex-wrap gap-1.5">
              {MEAL_FILTERS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMealFilter(m)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    mealFilter === m
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                  }`}
                >
                  {m === "all" ? "All" : MEAL_LABEL[m as MealType]}
                </button>
              ))}
            </div>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {(["placed", "preparing", "out_for_delivery", "delivered", "cancelled"] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                    statusFilter === f
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  }`}
                >
                  {f.replace(/_/g, " ")}
                </button>
              ))}
              <button
                onClick={() => setStatusFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  statusFilter === "all"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* ── Summary bar ── */}
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2">
          {!isLoading && !error ? (
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{ordersData?.total ?? 0}</span> order{(ordersData?.total ?? 0) !== 1 ? "s" : ""}
              {mealFilter !== "all" ? <> · <span className="font-medium">{MEAL_LABEL[mealFilter as MealType]}</span></> : ""}
              {statusFilter !== "all" ? <> · <span className="font-medium capitalize">{statusFilter.replace(/_/g, " ")}</span></> : ""}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Loading…</span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          Failed to load orders: {(error as any)?.message}
        </div>
      )}

      {/* Order list */}
      <div className="mt-4 space-y-3">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-56" />
              </div>
              <div className="space-y-2 text-right">
                <Skeleton className="h-7 w-20 ml-auto" />
                <Skeleton className="h-8 w-32 ml-auto" />
              </div>
            </div>
          </Card>
        ))}

        {!isLoading && !error && orders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No orders for {formatDateLabel(date)}
            {mealFilter !== "all" ? ` — ${MEAL_LABEL[mealFilter as MealType]}` : ""}
            {statusFilter !== "all" ? ` (${statusFilter.replace(/_/g, " ")})` : ""}
          </div>
        )}

        {orders.map((o: any) => {
          const next = NEXT[o.status];
          const profile = o.profiles as { full_name?: string; phone?: string } | null;
          return (
            <Card key={o.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{profile?.full_name || "Customer"}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {MEAL_LABEL[o.meal_type as MealType]}
                    </Badge>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {profile?.phone ?? "—"} · {WINDOW_LABEL[o.meal_type as MealType][o.delivery_window as "round_1" | "round_2"]}
                    {o.delivery_otp && <> · OTP <span className="font-bold text-foreground">{o.delivery_otp}</span></>}
                  </div>
                  <div className="mt-1.5 text-sm">
                    {o.order_items?.map((i: any) => `${i.qty}× ${i.name}`).join(", ")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate max-w-sm">{o.address}</div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-lg font-bold">{fmtINR(Number(o.total))}</div>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    {(o.status === "placed" || o.status === "preparing") && (
                      <select
                        value={o.rider_id ?? ""}
                        onChange={(e) => e.target.value && assign(o.id, e.target.value)}
                        className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                      >
                        <option value="">{o.rider_id ? "Reassign…" : "Assign rider…"}</option>
                        {riders?.map((r: any) => (
                          <option key={r.id} value={r.id}>
                            {r.name}{r.online ? " ●" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {next && (
                      <Button size="sm" onClick={() => advance(o.id, next, o.meal_type)}>
                        Mark {next.replace(/_/g, " ")}
                      </Button>
                    )}
                    {o.status !== "delivered" && o.status !== "cancelled" && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(o.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  placed:           "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  preparing:        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  out_for_delivery: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  delivered:        "bg-green-500/15 text-green-700 dark:text-green-400",
  cancelled:        "bg-red-500/15 text-red-600 dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_COLOR[status] ?? "bg-muted"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
