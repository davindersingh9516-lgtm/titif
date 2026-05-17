import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Gift, Sparkles, Star, TrendingDown, Activity } from "lucide-react";

export const Route = createFileRoute("/admin/growth")({
  component: AdminGrowthPage,
});

function AdminGrowthPage() {
  const { data: kpis } = useQuery({
    queryKey: ["admin_growth_kpis"],
    queryFn: async () => {
      const { data } = await supabase.rpc("admin_growth_kpis");
      return data as Record<string, number> | null;
    },
    refetchInterval: 60_000,
  });

  const { data: referrals } = useQuery({
    queryKey: ["admin_referrals"],
    queryFn: async () => {
      const { data } = await supabase
        .from("referrals")
        .select("id, status, reward_amount, created_at, rewarded_at, referrer_id, referee_id")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: ratings } = useQuery({
    queryKey: ["admin_ratings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("order_ratings")
        .select("order_id, food_rating, rider_rating, comment, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Growth & Retention</h1>
        <p className="text-sm text-muted-foreground">Referrals, loyalty, ratings, and customer health.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={Users} label="Active 30d" value={kpis?.active_30d ?? 0} />
        <Kpi icon={TrendingDown} label="Inactive 14d" value={kpis?.inactive_14d ?? 0} />
        <Kpi icon={Gift} label="Referrals rewarded" value={kpis?.referrals_rewarded ?? 0} />
        <Kpi icon={Activity} label="Referral payout 30d" value={`₹${kpis?.referral_payout_30d ?? 0}`} />
        <Kpi icon={Sparkles} label="Loyalty outstanding" value={(kpis?.loyalty_outstanding ?? 0).toLocaleString("en-IN")} />
        <Kpi icon={Sparkles} label="Loyalty lifetime" value={(kpis?.loyalty_lifetime ?? 0).toLocaleString("en-IN")} />
        <Kpi icon={Star} label="Food rating 30d" value={`${kpis?.rating_avg_food_30d ?? 0}/5`} />
        <Kpi icon={Star} label="Rider rating 30d" value={`${kpis?.rating_avg_rider_30d ?? 0}/5`} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent referrals</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Reward</th>
                <th className="px-3 py-2 text-right">Rewarded at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {referrals?.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No referrals yet</td></tr>
              )}
              {referrals?.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{new Date(r.created_at).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "rewarded" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.reward_amount ? `₹${r.reward_amount}` : "—"}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                    {r.rewarded_at ? new Date(r.rewarded_at).toLocaleString("en-IN") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent ratings</h2>
        <div className="space-y-2">
          {ratings?.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">No ratings yet</div>
          )}
          {ratings?.map((r) => (
            <div key={r.order_id} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium">Food {r.food_rating}/5 · Rider {r.rider_rating ?? "—"}/5</div>
                <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN")}</div>
              </div>
              {r.comment && <div className="mt-1 text-xs text-muted-foreground">"{r.comment}"</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
