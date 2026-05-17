import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtINR, MEAL_LABEL, type MealType } from "@/lib/meals";
import { toast } from "sonner";
import {
  Repeat2, Users, Utensils, Sun, Moon, PlayCircle,
  CheckCircle2, PauseCircle, AlertCircle, RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/admin/subscriptions")({
  component: SubscriptionsAdmin,
});

const MEAL_COLOR: Record<string, string> = {
  breakfast: "text-amber-600 bg-amber-500/10",
  lunch:     "text-green-600 bg-green-500/10",
  dinner:    "text-purple-600 bg-purple-500/10",
};
const MEAL_DOT: Record<string, string> = {
  breakfast: "bg-amber-500",
  lunch:     "bg-green-500",
  dinner:    "bg-purple-500",
};

function isoToday(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function SubscriptionsAdmin() {
  const qc = useQueryClient();
  const [genDate, setGenDate] = useState(isoToday);
  const [genResult, setGenResult] = useState<any>(null);

  // KPIs for the selected generate-date
  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis } = useQuery({
    queryKey: ["sub-kpis", genDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_subscription_kpis", { p_date: genDate });
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 60_000,
  });

  // Subscriber list
  const { data: subscribers = [], isLoading: subsLoading } = useQuery({
    queryKey: ["subscriber-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_subscriber_list");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("generate_subscription_orders", { p_date: genDate });
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      setGenResult(result);
      toast.success(`Generated ${result.created} order${result.created !== 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["sub-kpis"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-kpis"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Auto-order management · {subscribers.length} active subscriber{subscribers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => { refetchKpis(); qc.invalidateQueries({ queryKey: ["subscriber-list"] }); }}
          className="rounded-lg p-2 hover:bg-muted transition text-muted-foreground"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpisLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
        ) : (
          <>
            <KpiCard label="Active subscribers" value={kpis?.total_active ?? 0} icon={<Users className="h-5 w-5" />} color="text-primary" />
            <KpiCard label="Breakfast today" value={kpis?.breakfast_total ?? 0} icon={<span className="text-lg">☀️</span>} color="text-amber-600" sub={`${kpis?.breakfast_ordered ?? 0} ordered`} />
            <KpiCard label="Lunch today" value={kpis?.lunch_total ?? 0} icon={<span className="text-lg">🍱</span>} color="text-green-600" sub={`${kpis?.lunch_ordered ?? 0} ordered`} />
            <KpiCard label="Dinner today" value={kpis?.dinner_total ?? 0} icon={<span className="text-lg">🌙</span>} color="text-purple-600" sub={`${kpis?.dinner_ordered ?? 0} ordered`} />
          </>
        )}
      </div>

      {/* Generate orders section */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Generate Subscription Orders</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Auto-place orders for all active subscribers on a given date. Already-placed or paused meals are skipped. Wallet is debited per order.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={genDate}
            onChange={(e) => { if (e.target.value) { setGenDate(e.target.value); setGenResult(null); } }}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="gap-2"
          >
            <PlayCircle className="h-4 w-4" />
            {generateMutation.isPending ? "Generating…" : "Generate orders"}
          </Button>
          {!kpisLoading && kpis && (
            <div className="flex gap-3 text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">
                  {(kpis.breakfast_pending ?? 0) + (kpis.lunch_pending ?? 0) + (kpis.dinner_pending ?? 0)}
                </span> pending
              </span>
              <span>
                <span className="font-semibold text-foreground">
                  {kpis.total_paused_today ?? 0}
                </span> paused
              </span>
            </div>
          )}
        </div>

        {/* Result */}
        {genResult && (
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="text-sm font-semibold mb-2">Generation complete · {genResult.date}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
              <ResultStat icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Created" value={genResult.created} />
              <ResultStat icon={<PauseCircle  className="h-4 w-4 text-slate-500" />}  label="Paused"  value={genResult.skipped_paused} />
              <ResultStat icon={<Repeat2      className="h-4 w-4 text-blue-500" />}   label="Existing" value={genResult.skipped_existing} />
              <ResultStat icon={<AlertCircle  className="h-4 w-4 text-amber-600" />}  label="Low wallet" value={genResult.skipped_low_wallet} />
            </div>
            {genResult.errors > 0 && (
              <div className="mt-2 text-xs text-destructive">{genResult.errors} error{genResult.errors !== 1 ? "s" : ""} — check menu items are active</div>
            )}
          </div>
        )}
      </Card>

      {/* Expected today breakdown */}
      {!kpisLoading && kpis && (
        <div className="grid grid-cols-3 gap-3">
          {(["breakfast", "lunch", "dinner"] as MealType[]).map((meal) => {
            const total   = kpis[`${meal}_total`]   ?? 0;
            const ordered = kpis[`${meal}_ordered`] ?? 0;
            const pending = kpis[`${meal}_pending`] ?? 0;
            const paused  = total - ordered - pending;
            return (
              <div key={meal} className="rounded-2xl border border-border bg-card p-4 space-y-2">
                <div className={`text-xs font-bold uppercase tracking-wide ${MEAL_COLOR[meal]}`}>
                  {MEAL_LABEL[meal]}
                </div>
                <div className="text-2xl font-bold">{total}</div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>Ordered</span><span className="font-semibold text-foreground">{ordered}</span></div>
                  <div className="flex justify-between"><span>Pending</span><span className="font-semibold text-amber-600">{pending}</span></div>
                  <div className="flex justify-between"><span>Paused</span><span className="font-semibold text-slate-400">{paused < 0 ? 0 : paused}</span></div>
                </div>
                {total > 0 && (
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all"
                      style={{ width: `${(ordered / total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Subscriber list */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Active Subscribers</h2>
        {subsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
          </div>
        ) : subscribers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No active subscribers yet
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Customer</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Meals</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Size</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Period</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Pauses</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {subscribers.map((s: any) => (
                  <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.full_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.phone || "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(s.meal_types as MealType[]).map((m: MealType) => (
                          <span key={m} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${MEAL_COLOR[m]}`}>
                            {MEAL_LABEL[m]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-xs">{s.size}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(s.start_date)} →<br />{formatDate(s.end_date)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${s.pause_count > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {s.pause_count} day{s.pause_count !== 1 ? "s" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, color, sub }: {
  label: string; value: number; icon: React.ReactNode; color: string; sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4">
      <div className={`mb-1 ${color}`}>{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function ResultStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:    "bg-green-500/15 text-green-700 dark:text-green-400",
    paused:    "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    cancelled: "bg-red-500/15 text-red-600 dark:text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${styles[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00+05:30").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}
