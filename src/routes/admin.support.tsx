import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { fmtINR } from "@/lib/meals";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/support")({
  component: AdminSupport,
});

const FILTERS = ["open", "in_progress", "waiting_customer", "resolved", "all"] as const;
type Filter = (typeof FILTERS)[number];

const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

function AdminSupport() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [resolution, setResolution] = useState("");
  const [refund, setRefund] = useState("");

  const { data: kpis } = useQuery({
    queryKey: ["support-kpis"],
    queryFn: async () => (await supabase.rpc("admin_support_kpis")).data as Record<string, number> | null,
    refetchInterval: 30_000,
  });

  const { data: tickets } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: async () => {
      const { data: ts } = await supabase
        .from("support_tickets")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(200);
      const list = ts ?? [];
      const ids = Array.from(new Set(list.map((t) => t.user_id)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, full_name, phone").in("id", ids)
        : { data: [] as { id: string; full_name: string | null; phone: string | null }[] };
      const map = new Map((profs ?? []).map((p) => [p.id, p]));
      return list.map((t) => ({ ...t, profile: map.get(t.user_id) ?? null })) as Array<
        typeof list[number] & { profile: { full_name: string | null; phone: string | null } | null }
      >;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["admin-ticket-msgs", activeId],
    queryFn: async () => {
      if (!activeId) return [];
      const { data } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticket_id", activeId)
        .order("created_at");
      return data ?? [];
    },
    enabled: !!activeId,
  });

  useEffect(() => {
    const ch = supabase
      .channel("admin:support")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-tickets"] });
        qc.invalidateQueries({ queryKey: ["support-kpis"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, (p: any) => {
        if (p.new?.ticket_id === activeId) qc.invalidateQueries({ queryKey: ["admin-ticket-msgs", activeId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, activeId]);

  const filtered = useMemo(() => {
    if (!tickets) return [];
    if (filter === "all") return tickets;
    return tickets.filter((t: any) => t.status === filter);
  }, [tickets, filter]);

  const active = tickets?.find((t: any) => t.id === activeId);

  const sendReply = async () => {
    if (!activeId || reply.trim().length < 1) return;
    const { error } = await supabase.rpc("add_support_message", { p_ticket_id: activeId, p_body: reply.trim() });
    if (error) { toast.error(error.message); return; }
    setReply("");
  };

  const setStatus = async (status: string, priority?: string) => {
    if (!activeId) return;
    const { error } = await supabase.rpc("admin_set_ticket_status", {
      p_ticket_id: activeId,
      p_status: status as never,
      p_priority: (priority as never) ?? undefined,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Updated");
  };

  const resolveWithRefund = async () => {
    if (!activeId) return;
    const amt = Number(refund || 0);
    if (Number.isNaN(amt) || amt < 0) { toast.error("Invalid refund"); return; }
    const { error } = await supabase.rpc("admin_resolve_ticket_with_refund", {
      p_ticket_id: activeId,
      p_resolution: resolution.trim() || "Resolved",
      p_refund: amt,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(amt > 0 ? "Resolved with refund" : "Resolved");
    setResolution(""); setRefund("");
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <span className="text-xs text-muted-foreground">Live · auto-updates</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Open" value={kpis?.open ?? 0} />
        <Kpi label="In progress" value={kpis?.in_progress ?? 0} />
        <Kpi label="Awaiting customer" value={kpis?.waiting_customer ?? 0} />
        <Kpi label="Urgent" value={kpis?.urgent_open ?? 0} accent />
        <Kpi label="Resolved 7d" value={kpis?.resolved_7d ?? 0} />
        <Kpi label="Avg hours" value={kpis?.avg_resolution_hours ?? 0} />
      </div>
      {(kpis?.refunds_7d_count ?? 0) > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          Refunds last 7d: {kpis?.refunds_7d_count} · {fmtINR(Number(kpis?.refunds_7d_amount ?? 0))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No tickets
              </div>
            )}
            {filtered.map((t: any) => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  activeId === t.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{String(t.status).replace("_", " ")}</Badge>
                  {(t.priority === "high" || t.priority === "urgent") && (
                    <Badge variant="destructive" className="text-[10px]">{t.priority}</Badge>
                  )}
                </div>
                <div className="mt-1 truncate text-sm font-semibold">{t.subject}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.profile?.full_name || "Customer"} · {t.profile?.phone || ""}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(t.last_message_at).toLocaleString("en-IN")}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!active && (
            <Card className="p-10 text-center text-sm text-muted-foreground">Select a ticket to view</Card>
          )}
          {active && (
            <Card className="flex h-[calc(100svh-280px)] min-h-[500px] flex-col overflow-hidden">
              <div className="border-b border-border p-4">
                <div className="text-base font-semibold">{active.subject}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {active.profile?.full_name} · {active.profile?.phone} · category: {active.category}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={active.status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                  <select
                    value={active.priority}
                    onChange={(e) => setStatus(active.status, e.target.value)}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                  >
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {active.order_id && (
                    <span className="text-xs text-muted-foreground">Order: {String(active.order_id).slice(0, 8)}…</span>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
                {messages?.map((m: any) => (
                  <div key={m.id} className={`flex ${m.is_admin ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      m.is_admin ? "bg-primary text-primary-foreground" : "bg-card"
                    }`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className="mt-1 text-[10px] opacity-60">
                        {new Date(m.created_at).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={2}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply to customer…"
                    className="resize-none"
                  />
                  <Button onClick={sendReply} disabled={reply.trim().length < 1}>Send</Button>
                </div>

                {active.status !== "resolved" && active.status !== "closed" && (
                  <div className="mt-3 rounded-lg border border-border p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Resolve ticket
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                      <Input
                        placeholder="Resolution note"
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                      />
                      <Input
                        placeholder="Refund ₹ (optional)"
                        type="number"
                        min={0}
                        value={refund}
                        onChange={(e) => setRefund(e.target.value)}
                      />
                      <Button onClick={resolveWithRefund} variant="default">Resolve</Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card className={`p-3 ${accent ? "border-destructive/40" : ""}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent ? "text-destructive" : ""}`}>{value}</div>
    </Card>
  );
}
