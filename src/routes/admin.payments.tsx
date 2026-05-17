import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fmtINR, isoDate, toIST } from "@/lib/meals";
import {
  CheckCircle2, XCircle, Wallet,
  ChevronLeft, ChevronRight, CalendarDays,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/payments")({
  component: AdminPaymentsPage,
});

type Tab = "pending" | "success" | "failed";
type DatePreset = "today" | "week" | "month" | "custom";

const PAGE_SIZE = 25;

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

function AdminPaymentsPage() {
  const qc = useQueryClient();
  const [tab, setTab]         = useState<Tab>("pending");
  const [preset, setPreset]   = useState<DatePreset>("month");
  const [customFrom, setFrom] = useState(isoDate(new Date()));
  const [customTo,   setTo]   = useState(isoDate(new Date()));
  const [page, setPage]       = useState(0);

  // Reset page when tab or date changes
  useEffect(() => setPage(0), [tab, preset, customFrom, customTo]);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin_payments", tab, from, to, page],
    queryFn: async () => {
      const { data, count, error } = await (supabase as any)
        .from("payments")
        .select(
          "id, amount, status, utr_reference, qr_payload, created_at, updated_at, user_id, profiles!payments_user_id_fkey(full_name, phone)",
          { count: "exact" }
        )
        .eq("status", tab)
        .gte("created_at", from + "T00:00:00+05:30")
        .lte("created_at", to + "T23:59:59+05:30")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as any[], total: count ?? 0 };
    },
  });

  const rows       = data?.rows ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Realtime: refresh on any payment change
  useEffect(() => {
    const ch = supabase
      .channel("admin:payments")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        qc.invalidateQueries({ queryKey: ["admin_payments"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const verify = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_verify_payment", { p_payment_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment verified · wallet credited");
      qc.invalidateQueries({ queryKey: ["admin_payments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_reject_payment", {
        p_payment_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment rejected");
      qc.invalidateQueries({ queryKey: ["admin_payments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const PRESETS: { id: DatePreset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week",  label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <header>
        <h1 className="text-xl font-bold tracking-tight">Wallet payments</h1>
        <p className="text-sm text-muted-foreground">Verify customer UPI top-ups. Wallet credits are atomic.</p>
      </header>

      {/* Filters row: status tabs + date preset */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        {/* Status tabs */}
        <div className="inline-flex rounded-full border border-border bg-muted/40 p-1">
          {(["pending", "success", "failed"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Date presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
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
            <div className="flex items-center gap-2 pt-1">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">From</label>
                <input type="date" value={customFrom} onChange={e => setFrom(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">To</label>
                <input type="date" value={customTo} onChange={e => setTo(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading && (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <Wallet className="h-6 w-6 opacity-40" />
            No {tab} payments for this period
          </div>
        )}
        {rows.map((p: any) => (
          <PaymentRow
            key={p.id}
            row={p}
            onVerify={() => verify.mutate(p.id)}
            onReject={(reason) => reject.mutate({ id: p.id, reason })}
            busy={verify.isPending || reject.isPending}
          />
        ))}

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
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
      </div>
    </div>
  );
}

function PaymentRow({
  row, onVerify, onReject, busy,
}: {
  row: any; onVerify: () => void; onReject: (reason: string) => void; busy: boolean;
}) {
  const [reason, setReason]       = useState("");
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="border-b border-border p-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">{fmtINR(Number(row.amount))}</span>
            <Badge
              variant="outline"
              className={
                row.status === "success"
                  ? "border-green-400/40 bg-green-500/10 text-green-700 dark:text-green-400"
                  : row.status === "failed"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-700"
              }
            >
              {row.status}
            </Badge>
          </div>
          <div className="mt-0.5 text-sm font-medium">
            {row.profiles?.full_name || "Customer"} · {row.profiles?.phone || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            UTR: <span className="font-mono">{row.utr_reference ?? "not submitted"}</span>
            {" · "}
            {new Date(row.created_at).toLocaleString("en-IN", {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
            })}
          </div>
        </div>

        {row.status === "pending" && row.utr_reference && (
          <div className="flex items-center gap-2">
            {!showReject ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setShowReject(true)} disabled={busy}>
                  <XCircle className="mr-1 h-4 w-4" /> Reject
                </Button>
                <Button size="sm" onClick={onVerify} disabled={busy}
                  className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Verify & credit
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason for rejection"
                  className="h-9 w-52"
                />
                <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
                <Button
                  size="sm" variant="destructive"
                  onClick={() => {
                    if (reason.trim().length < 3) return toast.error("Reason required (min 3 chars)");
                    onReject(reason.trim());
                    setShowReject(false);
                    setReason("");
                  }}
                  disabled={busy}
                >
                  Confirm reject
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
