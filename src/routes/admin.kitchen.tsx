import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ChefHat, Package, Truck, RefreshCw,
  CheckCircle2, Clock, BoxIcon, Bike, XCircle, Play, Timer,
} from "lucide-react";

// Delivery windows (IST) — matches WINDOW_LABEL in meals.ts
// round_1 + round_2 span:  breakfast 7–9, lunch 12–14, dinner 19–21
const MEAL_WINDOWS: Record<string, { startH: number; startM: number; endH: number; endM: number }> = {
  breakfast: { startH:  7, startM: 0, endH:  9, endM: 0 },
  lunch:     { startH: 12, startM: 0, endH: 14, endM: 0 },
  dinner:    { startH: 19, startM: 0, endH: 21, endM: 0 },
};

type WindowStatus = "upcoming" | "active" | "ended";

function getMealWindow(mealKey: string, forDate: string): {
  status: WindowStatus; label: string; timeLabel: string;
} {
  const IST_MS  = 19_800_000;
  const nowIST  = new Date(Date.now() + IST_MS);
  const todayIST = nowIST.toISOString().slice(0, 10);
  const w       = MEAL_WINDOWS[mealKey];

  const timeLabel = `${String(w.startH).padStart(2, "0")}:00 – ${String(w.endH).padStart(2, "0")}:00`;

  if (forDate !== todayIST) {
    return { status: forDate < todayIST ? "ended" : "upcoming", label: "", timeLabel };
  }

  const nowMins  = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
  const startMin = w.startH * 60 + w.startM;
  const endMin   = w.endH   * 60 + w.endM;

  if (nowMins < startMin) {
    const diff = startMin - nowMins;
    const h = Math.floor(diff / 60), m = diff % 60;
    return { status: "upcoming", label: h > 0 ? `starts in ${h}h ${m}m` : `starts in ${m}m`, timeLabel };
  }
  if (nowMins <= endMin) {
    const diff = endMin - nowMins;
    const h = Math.floor(diff / 60), m = diff % 60;
    return { status: "active", label: h > 0 ? `${h}h ${m}m left` : `${m}m left`, timeLabel };
  }
  return { status: "ended", label: "window ended — auto-delivering soon", timeLabel };
}

export const Route = createFileRoute("/admin/kitchen")({ component: KitchenPage });

type Plan = {
  date: string; orders_total: number; mini_total: number; large_total: number;
  breakfast_total: number; pending_prep: number; prepping: number; packed: number;
  ready: number; unbatched: number;
};
type OrderRow = {
  order_id: string; full_name: string | null; phone: string | null; address: string;
  meal_type: "breakfast" | "lunch" | "dinner"; delivery_window: string; status: string;
  prep_status: string; batch_id: string | null; total: number;
  mini: number; large: number; fixed: number;
};
type Batch = {
  id: string; delivery_date: string; meal_type: string; round_label: string;
  status: string; planned_mini: number; planned_large: number; planned_breakfast: number;
  rider_id: string | null; dispatched_at: string | null; created_at: string;
};
type Rider = { id: string; name: string; online: boolean; active: boolean };

const MEALS = ["breakfast", "lunch", "dinner"] as const;
type MealKey = typeof MEALS[number];

const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// Determine the collective prep stage for a group of orders.
// Returns the "lowest" stage so the pipeline shows what's still in progress.
function collectiveStatus(orders: OrderRow[]): string {
  if (orders.length === 0) return "pending";
  const s = orders.map(o => o.prep_status);
  if (s.every(x => x === "ready")) return "ready";
  if (s.every(x => x === "packed" || x === "ready")) return "packed";
  if (s.some(x => x !== "pending")) return "prepping";
  return "pending";
}

const STAGE_ICONS = { prepping: Clock, packed: BoxIcon, ready: CheckCircle2 } as const;

const STAGE_ACTIVE_CLASS: Record<string, string> = {
  prepping: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  packed:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ready:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const STAGE_BADGE_CLASS: Record<string, string> = {
  prepping: "bg-amber-500 text-white",
  packed:   "bg-blue-500 text-white",
  ready:    "bg-emerald-500 text-white",
};

function KitchenPage() {
  const [date, setDate]             = useState(todayIST());
  const [mealFilter, setMealFilter] = useState<"all" | MealKey>("all");
  const [plan, setPlan]             = useState<Plan | null>(null);
  const [orders, setOrders]         = useState<OrderRow[]>([]);
  const [batches, setBatches]       = useState<Batch[]>([]);
  const [riders, setRiders]         = useState<Rider[]>([]);
  const [loading, setLoading]       = useState(false);
  const [bulkBusy, setBulkBusy]     = useState<string>("");  // meal currently being bulk-updated
  const [tick, setTick]             = useState(0);           // clock tick for window countdown

  const [batchDialog, setBatchDialog]       = useState<{ meal: MealKey } | null>(null);
  const [batchLabel, setBatchLabel]         = useState("R1");
  const [batchBusy, setBatchBusy]           = useState(false);

  const [dispatchDialog, setDispatchDialog] = useState<{ batchId: string } | null>(null);
  const [selectedRider, setSelectedRider]   = useState<string>("");
  const [dispatchBusy, setDispatchBusy]     = useState(false);

  const [stopDialog, setStopDialog]         = useState<{ meal: MealKey } | null>(null);
  const [stopReason, setStopReason]         = useState("");
  const [stopBusy, setStopBusy]             = useState(false);

  async function load() {
    setLoading(true);
    const mealArg = mealFilter === "all" ? null : mealFilter;
    const [{ data: pl }, { data: ord }, { data: bt }, { data: rd }] = await Promise.all([
      supabase.rpc("kitchen_plan", { p_date: date, p_meal: mealArg as any }),
      supabase.rpc("kitchen_today_orders", { p_date: date, p_meal: mealArg as any }),
      supabase.from("kitchen_batches").select("*").eq("delivery_date", date).order("created_at", { ascending: false }),
      supabase.from("riders").select("id,name,online,active").eq("active", true).order("name"),
    ]);
    setPlan((pl as Plan) ?? null);
    setOrders((ord as OrderRow[]) ?? []);
    setBatches((bt as Batch[]) ?? []);
    setRiders((rd as Rider[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [date, mealFilter]);

  // Update window countdowns every minute
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel("kitchen-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_batches" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [date, mealFilter]);

  // Bulk-update ALL orders of a meal to the given prep stage
  async function setBulkPrep(mealKey: MealKey, status: string) {
    const mealOrders = orders.filter(o => o.meal_type === mealKey);
    if (mealOrders.length === 0) return;
    setBulkBusy(mealKey);
    const results = await Promise.all(
      mealOrders.map(o =>
        supabase.rpc("kitchen_set_order_prep", { p_order_id: o.order_id, p_status: status })
      )
    );
    setBulkBusy("");
    const failed = results.filter(r => r.error).length;
    if (failed > 0) toast.error(`${failed} order(s) failed to update`);
    else toast.success(`All ${mealKey} marked as ${status}`);
    load();
  }

  async function openMeal(mealKey: MealKey) {
    const { error } = await supabase.rpc("kitchen_meal_toggle", {
      p_date: date, p_meal: mealKey, p_open: true, p_note: "Reopened",
    });
    if (error) toast.error(error.message); else toast.success(`${mealKey} reopened`);
  }

  async function confirmCreateBatch() {
    if (!batchDialog) return;
    setBatchBusy(true);
    const { error } = await supabase.rpc("kitchen_create_batch", {
      p_date: date, p_meal: batchDialog.meal, p_round: batchLabel || "R1",
    });
    setBatchBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Batch created");
    setBatchDialog(null);
    setBatchLabel("R1");
    load();
  }

  async function confirmDispatch() {
    if (!dispatchDialog || !selectedRider) return;
    setDispatchBusy(true);
    const { error } = await supabase.rpc("kitchen_dispatch_batch", {
      p_batch_id: dispatchDialog.batchId, p_rider_id: selectedRider,
    });
    setDispatchBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Dispatched to rider");
    setDispatchDialog(null);
    setSelectedRider("");
    load();
  }

  async function confirmStop() {
    if (!stopDialog) return;
    setStopBusy(true);
    const { error } = await supabase.rpc("kitchen_meal_toggle", {
      p_date: date, p_meal: stopDialog.meal, p_open: false,
      p_note: stopReason.trim() || "Stopped by kitchen",
    });
    setStopBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${stopDialog.meal} stopped`);
    setStopDialog(null);
    setStopReason("");
  }

  const ordersByMeal = useMemo(() => {
    const result: Record<MealKey, OrderRow[]> = { breakfast: [], lunch: [], dinner: [] };
    for (const o of orders) result[o.meal_type]?.push(o);
    return result;
  }, [orders]);

  const visibleMeals: MealKey[] = mealFilter === "all" ? [...MEALS] : [mealFilter];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ChefHat className="h-6 w-6" /> Kitchen Operations
          </h1>
          <p className="text-sm text-muted-foreground">Bulk prep control · Batching · Dispatch</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="rounded-lg border bg-background px-3 py-1.5 text-sm"
          />
          <div className="flex rounded-lg border p-0.5">
            {(["all", ...MEALS] as const).map(m => (
              <button key={m} onClick={() => setMealFilter(m)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition ${
                  mealFilter === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>{m}</button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {[
          { label: "Orders",    value: plan?.orders_total ?? 0 },
          { label: "Breakfast", value: plan?.breakfast_total ?? 0 },
          { label: "Mini",      value: plan?.mini_total ?? 0 },
          { label: "Large",     value: plan?.large_total ?? 0 },
          { label: "Pending",   value: plan?.pending_prep ?? 0 },
          { label: "Packed",    value: plan?.packed ?? 0 },
          { label: "Unbatched", value: plan?.unbatched ?? 0 },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-2xl font-bold">{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Meal sections ── */}
      {visibleMeals.map(mealKey => {
        const mealOrders = ordersByMeal[mealKey];
        const status     = collectiveStatus(mealOrders);
        const isBusy     = bulkBusy === mealKey;

        const miniCount  = mealOrders.reduce((s, o) => s + o.mini, 0);
        const largeCount = mealOrders.reduce((s, o) => s + o.large, 0);
        const fixedCount = mealOrders.reduce((s, o) => s + o.fixed, 0);

        const itemSummary = [
          miniCount  > 0 && `Mini × ${miniCount}`,
          largeCount > 0 && `Large × ${largeCount}`,
          fixedCount > 0 && `Fixed × ${fixedCount}`,
        ].filter(Boolean).join("  ·  ");

        const win = getMealWindow(mealKey, date);

        return (
          <div key={mealKey} className="rounded-2xl border bg-card overflow-hidden">

            {/* Section header */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b bg-muted/20">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="font-bold capitalize text-lg">{mealKey}</h2>
                  <Badge variant="secondary">{mealOrders.length} orders</Badge>
                  {status !== "pending" && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STAGE_BADGE_CLASS[status]}`}>
                      {status}
                    </span>
                  )}
                  {/* Delivery window indicator */}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    win.status === "active"   ? "bg-green-500/10 text-green-700 dark:text-green-400" :
                    win.status === "upcoming" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
                                               "bg-muted text-muted-foreground"
                  }`}>
                    <Timer className="h-3 w-3" />
                    {win.timeLabel}
                    {win.label && ` · ${win.label}`}
                  </span>
                </div>
                {itemSummary && (
                  <p className="text-xs text-muted-foreground mt-0.5">{itemSummary}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Bulk prep pipeline — single tap sets ALL orders */}
                {mealOrders.length > 0 && (
                  <div className="flex items-center gap-1 rounded-xl border bg-background p-1">
                    {(["prepping", "packed", "ready"] as const).map(stage => {
                      const Icon = STAGE_ICONS[stage];
                      const isActive = status === stage;
                      return (
                        <button
                          key={stage}
                          onClick={() => setBulkPrep(mealKey, stage)}
                          disabled={isBusy}
                          title={`Mark all ${mealKey} as ${stage}`}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition disabled:opacity-50 ${
                            isActive
                              ? STAGE_ACTIVE_CLASS[stage]
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          {isBusy ? "…" : stage}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Batch creation */}
                <Button size="sm" variant="outline"
                  onClick={() => { setBatchDialog({ meal: mealKey }); setBatchLabel("R1"); }}>
                  <Package className="h-3.5 w-3.5 mr-1" /> Batch
                </Button>

                {/* Stop / Open */}
                <Button size="sm" variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/5"
                  onClick={() => { setStopDialog({ meal: mealKey }); setStopReason(""); }}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Stop
                </Button>
                <Button size="sm" variant="outline"
                  className="border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  onClick={() => openMeal(mealKey)}>
                  <Play className="h-3.5 w-3.5 mr-1" /> Open
                </Button>
              </div>
            </div>

            {/* Order list — read-only info, no individual prep buttons */}
            {mealOrders.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No {mealKey} orders today
              </div>
            ) : (
              <div className="divide-y">
                {mealOrders.map((o, i) => (
                  <div key={o.order_id} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-5 text-center text-xs font-bold text-muted-foreground/60 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{o.full_name ?? "Customer"}</span>
                        <span className="text-xs text-muted-foreground">{o.delivery_window}</span>
                        {o.batch_id && (
                          <span className="text-[10px] font-medium bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                            {batches.find(b => b.id === o.batch_id)?.round_label ?? "Batched"}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {[
                          o.mini  > 0 && `Mini × ${o.mini}`,
                          o.large > 0 && `Large × ${o.large}`,
                          o.fixed > 0 && `Fixed × ${o.fixed}`,
                        ].filter(Boolean).join("  ·  ")}
                        {"  ·  "}{o.address}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums">₹{o.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Batches ── */}
      <div className="rounded-2xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> Batches</h2>
        </div>
        <div className="divide-y">
          {batches.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No batches yet today</div>
          )}
          {batches.map(b => {
            const riderName = riders.find(r => r.id === b.rider_id)?.name;
            return (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="capitalize">{b.meal_type}</Badge>
                    <span className="font-bold text-sm">{b.round_label}</span>
                    <Badge variant={b.status === "dispatched" ? "default" : "outline"} className="capitalize">
                      {b.status}
                    </Badge>
                    {riderName && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Bike className="h-3 w-3" /> {riderName}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(() => {
                      const bo = orders.filter(o => o.batch_id === b.id);
                      const lm = bo.reduce((s, o) => s + o.mini, 0);
                      const ll = bo.reduce((s, o) => s + o.large, 0);
                      const lf = bo.reduce((s, o) => s + o.fixed, 0);
                      const parts = [lm > 0 && `Mini ${lm}`, ll > 0 && `Large ${ll}`, lf > 0 && `BF ${lf}`].filter(Boolean);
                      return parts.length > 0 ? parts.join(" · ") : "No orders assigned";
                    })()}
                    {b.dispatched_at && ` · Dispatched ${new Date(b.dispatched_at).toLocaleTimeString("en-IN", {
                      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
                    })}`}
                  </div>
                </div>
                {b.status !== "dispatched" && (
                  <div className="flex items-center gap-2">
                    {/* Assign any unbatched orders for this meal into this batch */}
                    {orders.some(o => o.meal_type === b.meal_type && !o.batch_id) && (
                      <Button size="sm" variant="outline" onClick={async () => {
                        const { error } = await supabase
                          .from("orders")
                          .update({ batch_id: b.id, updated_at: new Date().toISOString() })
                          .eq("delivery_date", b.delivery_date)
                          .eq("meal_type", b.meal_type)
                          .is("batch_id", null)
                          .neq("status", "cancelled")
                          .neq("status", "delivered");
                        if (error) toast.error(error.message);
                        else { toast.success("Unbatched orders assigned"); load(); }
                      }}>
                        Assign unbatched
                      </Button>
                    )}
                    <Button size="sm" onClick={() => { setDispatchDialog({ batchId: b.id }); setSelectedRider(""); }}>
                      <Truck className="h-4 w-4 mr-1" /> Dispatch
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Dialog: Create Batch ── */}
      <Dialog open={!!batchDialog} onOpenChange={o => !o && setBatchDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Create {batchDialog?.meal} batch
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="round-label">Round label</Label>
            <Input
              id="round-label"
              value={batchLabel}
              onChange={e => setBatchLabel(e.target.value)}
              placeholder="e.g. R1, R2, Morning"
              onKeyDown={e => e.key === "Enter" && confirmCreateBatch()}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Used to group orders for a single dispatch run</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBatchDialog(null)}>Cancel</Button>
            <Button onClick={confirmCreateBatch} disabled={batchBusy || !batchLabel.trim()}>
              {batchBusy ? "Creating…" : "Create batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Dispatch to Rider ── */}
      <Dialog open={!!dispatchDialog} onOpenChange={o => !o && setDispatchDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              Dispatch to rider
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {riders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No active riders found</p>
            ) : (
              riders.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRider(r.id)}
                  className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    selectedRider === r.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${r.online ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.online ? "Online" : "Offline"}</div>
                  </div>
                  {selectedRider === r.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              ))
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDispatchDialog(null)}>Cancel</Button>
            <Button onClick={confirmDispatch} disabled={dispatchBusy || !selectedRider}>
              {dispatchBusy ? "Dispatching…" : "Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Stop Meal ── */}
      <Dialog open={!!stopDialog} onOpenChange={o => !o && setStopDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Stop {stopDialog?.meal} orders
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Users won't be able to place new {stopDialog?.meal} orders. Existing orders are not affected.
            </p>
            <Label htmlFor="stop-reason">Reason (optional)</Label>
            <Input
              id="stop-reason"
              value={stopReason}
              onChange={e => setStopReason(e.target.value)}
              placeholder="e.g. Ingredients unavailable"
              onKeyDown={e => e.key === "Enter" && confirmStop()}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setStopDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmStop} disabled={stopBusy}>
              {stopBusy ? "Stopping…" : "Stop meal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
