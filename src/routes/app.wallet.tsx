import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader } from "@/components/customer/AppHeader";
import { Button } from "@/components/ui/button";
import { fmtINR } from "@/lib/meals";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Plus, Clock } from "lucide-react";
import { LoyaltyCard } from "@/components/customer/LoyaltyCard";
import { useWallet } from "@/hooks/use-wallet";
import { AddMoneySheet } from "@/components/customer/AddMoneySheet";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/wallet")({
  component: WalletPage,
});

function WalletPage() {
  const { balance, walletLoading, transactions, payments, pendingPayment } = useWallet();
  const [open, setOpen] = useState(false);
  const [resume, setResume] = useState<{ id: string; amount: number; qr_payload: string | null } | null>(null);

  const openAdd = (r: typeof resume = null) => {
    setResume(r);
    setOpen(true);
  };

  return (
    <div>
      <AppHeader title="Wallet" back="/app" />

      {/* Balance hero */}
      <div className="bg-gradient-primary px-5 py-8 text-primary-foreground">
        <div className="inline-flex items-center gap-2 text-sm opacity-90">
          <Wallet className="h-4 w-4" /> Available balance
        </div>
        <div className="mt-1 text-4xl font-bold tabular-nums">
          {walletLoading ? <span className="opacity-60">···</span> : fmtINR(balance)}
        </div>
        <Button
          onClick={() => openAdd(null)}
          size="lg"
          className="mt-5 h-11 gap-2 rounded-full bg-white px-5 text-primary hover:bg-white/90"
        >
          <Plus className="h-4 w-4" /> Add money
        </Button>
      </div>

      {/* Pending payment banner */}
      {pendingPayment && (
        <button
          onClick={() =>
            openAdd({
              id: pendingPayment.id,
              amount: Number(pendingPayment.amount),
              qr_payload: pendingPayment.qr_payload,
            })
          }
          className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-left"
        >
          <Clock className="h-5 w-5 text-amber-600" />
          <div className="flex-1">
            <div className="text-sm font-semibold">
              Payment of {fmtINR(Number(pendingPayment.amount))} {pendingPayment.utr_reference ? "verifying" : "in progress"}
            </div>
            <div className="text-xs text-muted-foreground">
              {pendingPayment.utr_reference ? "Our team will verify shortly." : "Tap to complete payment."}
            </div>
          </div>
        </button>
      )}

      <section className="px-4 pt-5">
        <LoyaltyCard />
      </section>

      {/* Recent payments */}
      {payments.length > 0 && (
        <section className="px-4 pt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent payments</h2>
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            {payments.slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <Wallet className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{fmtINR(Number(p.amount))} via UPI</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(p.created_at).toLocaleString("en-IN")}</div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    p.status === "success"
                      ? "border-success/40 bg-success/10 text-success"
                      : p.status === "failed"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700"
                  }
                >
                  {p.status}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Transaction history */}
      <section className="px-4 pb-6 pt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {transactions.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No transactions yet</div>
          )}
          {transactions.map((t) => {
            const credit = Number(t.amount) > 0;
            return (
              <div key={t.id} className="flex items-center gap-3 p-3">
                <div className={`rounded-full p-2 ${credit ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {credit ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{t.description ?? t.type}</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(t.created_at).toLocaleString("en-IN")}</div>
                </div>
                <div className={`text-sm font-bold tabular-nums ${credit ? "text-success" : "text-foreground"}`}>
                  {credit ? "+" : ""}
                  {fmtINR(Number(t.amount))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <AddMoneySheet open={open} onClose={() => setOpen(false)} resume={resume} />
    </div>
  );
}
