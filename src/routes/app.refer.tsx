import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/customer/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gift, Copy, Share2, Users, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/app/refer")({
  component: ReferPage,
});

function ReferPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: myCode } = useQuery({
    queryKey: ["my_referral_code", user?.id],
    queryFn: async () => {
      const { data } = await supabase.rpc("my_referral_code");
      return data as string;
    },
    enabled: !!user,
  });

  const { data: refs } = useQuery({
    queryKey: ["my_referrals", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referrals")
        .select("id, status, reward_amount, created_at, referee_id")
        .eq("referrer_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: incoming } = useQuery({
    queryKey: ["incoming_referral", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referrals")
        .select("status, reward_amount")
        .eq("referee_id", user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const share = async () => {
    if (!myCode) return;
    const text = `Try Tiffin — fresh tiffins delivered hot. Use my code ${myCode} and we both get ₹50.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Tiffin", text });
      } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    }
  };

  const apply = async () => {
    if (!code.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("apply_referral_code", { p_code: code.trim().toUpperCase() });
    setBusy(false);
    if (error) {
      const map: Record<string, string> = {
        self_referral: "You can't use your own code",
        already_referred: "You've already applied a referral code",
        code_not_found: "That code doesn't exist",
      };
      const key = Object.keys(map).find((k) => error.message.includes(k));
      toast.error(key ? map[key] : error.message);
    } else {
      toast.success("Code applied · reward credits after your first delivered order");
      setCode("");
      qc.invalidateQueries({ queryKey: ["incoming_referral"] });
    }
  };

  const rewarded = refs?.filter((r) => r.status === "rewarded").length ?? 0;
  const pending = refs?.filter((r) => r.status === "pending").length ?? 0;
  const earned = refs?.reduce((s, r) => s + Number(r.reward_amount ?? 0), 0) ?? 0;

  return (
    <div className="pb-8">
      <AppHeader title="Refer & earn" back="/app" />

      <div className="bg-gradient-primary px-5 py-8 text-primary-foreground">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs">
          <Gift className="h-3.5 w-3.5" /> Both of you get ₹50
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight">Share Tiffin, share the love</h1>
        <p className="mt-1 text-sm opacity-90">
          Friend gets ₹50 on signup. You get ₹50 once they receive their first order.
        </p>

        <div className="mt-5 rounded-2xl bg-white/15 p-4 backdrop-blur">
          <div className="text-[11px] uppercase tracking-wider opacity-80">Your code</div>
          <div className="mt-1 flex items-center justify-between">
            <div className="text-3xl font-bold tracking-widest">{myCode ?? "…"}</div>
            <button
              onClick={() => {
                if (myCode) {
                  navigator.clipboard.writeText(myCode);
                  toast.success("Code copied");
                }
              }}
              className="rounded-full bg-white/20 p-2 hover:bg-white/30"
              aria-label="Copy code"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>

        <Button onClick={share} variant="secondary" className="mt-4 w-full gap-2 rounded-2xl">
          <Share2 className="h-4 w-4" /> Share with friends
        </Button>
      </div>

      <section className="px-4 pt-5">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Invited" value={refs?.length ?? 0} />
          <Stat label="Joined" value={rewarded} />
          <Stat label="Earned" value={`₹${earned}`} />
        </div>
        {pending > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {pending} friend{pending > 1 ? "s" : ""} pending — reward unlocks after their first delivered order.
          </p>
        )}
      </section>

      {!incoming && (
        <section className="px-4 pt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Have a code?
          </h2>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TIFXXXXXX"
              className="h-12 rounded-2xl text-base font-semibold tracking-widest"
              maxLength={12}
            />
            <Button onClick={apply} disabled={busy || code.length < 4} className="h-12 rounded-2xl px-5">
              Apply
            </Button>
          </div>
        </section>
      )}

      {incoming && (
        <section className="px-4 pt-6">
          <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <div>
              <div className="font-semibold">Referral applied</div>
              <div className="text-xs text-muted-foreground">
                {incoming.status === "rewarded"
                  ? `₹${incoming.reward_amount} credited to your wallet`
                  : "Place your first order to receive ₹50 in your wallet."}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="px-4 pt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your referrals
        </h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {refs?.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No referrals yet. Share your code to start earning.
            </div>
          )}
          {refs?.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-3">
              <div className="rounded-full bg-accent p-2">
                <Users className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Friend joined</div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("en-IN")}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-xs font-semibold ${
                    r.status === "rewarded" ? "text-success" : "text-muted-foreground"
                  }`}
                >
                  {r.status === "rewarded" ? `+₹${r.reward_amount}` : "Pending"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pt-6">
        <Link to="/app/wallet" className="text-xs text-primary underline">
          View wallet →
        </Link>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
