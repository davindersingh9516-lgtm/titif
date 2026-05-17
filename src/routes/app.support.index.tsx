import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ChevronRight, Plus, LifeBuoy, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/support/")({
  component: SupportHome,
});

const CATEGORIES: { value: string; label: string }[] = [
  { value: "delivery_delayed", label: "Delivery delayed" },
  { value: "delivery_wrong", label: "Wrong delivery" },
  { value: "delivery_failed", label: "Delivery failed" },
  { value: "payment_failed", label: "Payment failed" },
  { value: "wallet_not_updated", label: "Wallet not updated" },
  { value: "recharge_issue", label: "Recharge issue" },
  { value: "refund_request", label: "Refund request" },
  { value: "otp_issue", label: "OTP issue" },
  { value: "rider_issue", label: "Rider issue" },
  { value: "order_issue", label: "Order issue" },
  { value: "other", label: "Something else" },
];

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  in_progress: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  waiting_customer: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  resolved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  closed: "bg-muted text-muted-foreground",
};

function SupportHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: "", category: "other", message: "", order_id: "" });
  const [submitting, setSubmitting] = useState(false);

  const { data: tickets } = useQuery({
    queryKey: ["my-tickets", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("support_tickets")
        .select("id, subject, category, status, priority, last_message_at, created_at")
        .eq("user_id", user!.id)
        .order("last_message_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`tickets:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets", filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-tickets", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const submit = async () => {
    if (form.subject.trim().length < 3 || form.message.trim().length < 3) {
      toast.error("Add a short subject and message");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("create_support_ticket", {
      p_subject: form.subject.trim(),
      p_category: form.category as never,
      p_message: form.message.trim(),
      p_order_id: form.order_id || undefined,
      p_priority: "normal",
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Ticket created");
    setCreating(false);
    setForm({ subject: "", category: "other", message: "", order_id: "" });
    qc.invalidateQueries({ queryKey: ["my-tickets", user?.id] });
    if (data) nav({ to: "/app/support/$id", params: { id: String(data) } });
  };

  return (
    <div className="pb-24">
      <div className="bg-gradient-warm px-5 pt-8 pb-6 safe-top">
        <div className="flex items-center gap-3">
          <Link to="/app" className="rounded-full bg-card p-2 shadow-sm"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <div className="text-xs text-muted-foreground">Help & support</div>
            <div className="text-xl font-bold tracking-tight">How can we help?</div>
          </div>
        </div>
      </div>

      <div className="px-5 pt-5">
        {!creating && (
          <Button onClick={() => setCreating(true)} className="w-full" size="lg">
            <Plus className="mr-2 h-4 w-4" /> Raise a new issue
          </Button>
        )}

        {creating && (
          <Card className="p-4">
            <div className="space-y-3">
              <div>
                <Label>What's it about?</Label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Subject</Label>
                <Input
                  value={form.subject}
                  maxLength={120}
                  placeholder="e.g. Lunch arrived 1 hour late"
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                />
              </div>
              <div>
                <Label>Order ID (optional)</Label>
                <Input
                  value={form.order_id}
                  placeholder="Paste order ID if applicable"
                  onChange={(e) => setForm((f) => ({ ...f, order_id: e.target.value }))}
                />
              </div>
              <div>
                <Label>Describe the issue</Label>
                <Textarea
                  rows={4}
                  maxLength={1000}
                  value={form.message}
                  placeholder="Tell us what happened…"
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={submit} disabled={submitting} className="flex-1">
                  {submitting ? "Submitting…" : "Submit ticket"}
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Your tickets
        </h2>
        {(!tickets || tickets.length === 0) && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <LifeBuoy className="mx-auto mb-2 h-6 w-6 opacity-60" />
            No tickets yet. We're here when you need us.
          </div>
        )}
        <div className="space-y-2">
          {tickets?.map((t) => (
            <Link
              key={t.id}
              to="/app/support/$id"
              params={{ id: t.id }}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4"
            >
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_TONE[t.status] || ""} variant="outline">
                    {String(t.status).replace("_", " ")}
                  </Badge>
                  {(t.priority === "high" || t.priority === "urgent") && (
                    <Badge variant="destructive">{t.priority}</Badge>
                  )}
                </div>
                <div className="mt-1 truncate font-semibold">{t.subject}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(t.last_message_at).toLocaleString("en-IN")}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
