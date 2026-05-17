import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export function LoyaltyCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: acc } = useQuery({
    queryKey: ["loyalty", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("loyalty_accounts")
        .select("points, lifetime_points")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data ?? { points: 0, lifetime_points: 0 };
    },
    enabled: !!user,
  });

  const points = acc?.points ?? 0;
  const redeemable = Math.floor(points / 100) * 100;
  const cashValue = (redeemable / 100) * 10;

  const redeem = async () => {
    if (redeemable < 100) return;
    setBusy(true);
    const { error } = await supabase.rpc("redeem_loyalty_points", { p_points: redeemable });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`₹${cashValue} credited to wallet`);
      qc.invalidateQueries({ queryKey: ["loyalty"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["wallet_tx"] });
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-amber-50 to-amber-100 p-4 dark:from-amber-950/40 dark:to-amber-900/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-900/80 dark:text-amber-200/80">
            <Sparkles className="h-3.5 w-3.5" /> Tiffin Points
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">{points.toLocaleString("en-IN")}</div>
          <div className="text-[11px] text-muted-foreground">
            Lifetime {acc?.lifetime_points ?? 0} · 1 pt per ₹1 spent · 100 pts = ₹10
          </div>
        </div>
        <Button
          size="sm"
          disabled={redeemable < 100 || busy}
          onClick={redeem}
          className="rounded-full"
        >
          Redeem ₹{cashValue}
        </Button>
      </div>
    </div>
  );
}
