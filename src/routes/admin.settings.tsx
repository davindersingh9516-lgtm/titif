import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Clock, IndianRupee, QrCode, Truck, Sliders } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
});

type SettingsMap = Record<string, any>;

function AdminSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("key,value");
      if (error) throw error;
      const map: SettingsMap = {};
      (data ?? []).forEach((r: any) => { map[r.key] = r.value; });
      return map;
    },
  });

  const [cutoffs,  setCutoffs]  = useState({ breakfast_prev_night_hour: 23, lunch_hour: 10, dinner_hour: 15 });
  const [pricing,  setPricing]  = useState({ breakfast: 70, mini: 75, large: 120 });
  const [payments, setPayments] = useState({ upi_vpa: "", merchant_name: "" });
  const [rounds,   setRounds]   = useState({
    breakfast: "07:00-08:00, 08:00-09:00",
    lunch:     "12:00-13:00, 13:00-14:00",
    dinner:    "19:00-20:00, 20:00-21:00",
  });
  const [features, setFeatures] = useState({
    referrals: true, loyalty: true, support: true,
    wallet_topup: true, rider_tracking: true, push_notifications: false,
    referral_reward_amount: 50, monthly_referral_cap: 5,
  });
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    if (data.cutoffs)  setCutoffs({ ...cutoffs,  ...data.cutoffs });
    if (data.pricing)  setPricing({ ...pricing,  ...data.pricing });
    if (data.payments) setPayments({ ...payments, ...data.payments });
    if (data.features) setFeatures({ ...features, ...data.features });
    if (data.rounds) {
      setRounds({
        breakfast: (data.rounds.breakfast ?? []).join(", "),
        lunch:     (data.rounds.lunch     ?? []).join(", "),
        dinner:    (data.rounds.dinner    ?? []).join(", "),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function save(key: string, value: any) {
    setSaving(key);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    setSaving(null);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    toast.success(`${key} saved`);
    qc.invalidateQueries({ queryKey: ["app_settings"] });
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Cutoffs, pricing, delivery rounds & UPI merchant config.</p>
      </div>

      <Card className="p-5">
        <Section icon={Clock} title="Order cutoffs (IST)" desc="Lock orders past these hours per meal." />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Field label="Breakfast (prev night, hour)" value={cutoffs.breakfast_prev_night_hour}
            onChange={(v) => setCutoffs({ ...cutoffs, breakfast_prev_night_hour: Number(v) })} />
          <Field label="Lunch (same day, hour)"       value={cutoffs.lunch_hour}
            onChange={(v) => setCutoffs({ ...cutoffs, lunch_hour: Number(v) })} />
          <Field label="Dinner (same day, hour)"      value={cutoffs.dinner_hour}
            onChange={(v) => setCutoffs({ ...cutoffs, dinner_hour: Number(v) })} />
        </div>
        <SaveBtn onClick={() => save("cutoffs", cutoffs)} loading={saving === "cutoffs"} />
      </Card>

      <Card className="p-5">
        <Section icon={IndianRupee} title="Meal pricing" desc="Global prices — all thalis use these. Set in one place, reflected across the app." />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Field label="Breakfast (₹)"   value={pricing.breakfast} onChange={(v) => setPricing({ ...pricing, breakfast: Number(v) })} />
          <Field label="Mini Thali (₹)"  value={pricing.mini}      onChange={(v) => setPricing({ ...pricing, mini: Number(v) })} />
          <Field label="Large Thali (₹)" value={pricing.large}     onChange={(v) => setPricing({ ...pricing, large: Number(v) })} />
        </div>
        <SaveBtn onClick={() => save("pricing", pricing)} loading={saving === "pricing"} />
      </Card>

      <Card className="p-5">
        <Section icon={Truck} title="Delivery rounds" desc="Comma-separated time windows per meal." />
        <div className="mt-4 grid gap-3">
          <Field label="Breakfast windows" value={rounds.breakfast} onChange={(v) => setRounds({ ...rounds, breakfast: String(v) })} />
          <Field label="Lunch windows"     value={rounds.lunch}     onChange={(v) => setRounds({ ...rounds, lunch:     String(v) })} />
          <Field label="Dinner windows"    value={rounds.dinner}    onChange={(v) => setRounds({ ...rounds, dinner:    String(v) })} />
        </div>
        <SaveBtn
          onClick={() => save("rounds", {
            breakfast: rounds.breakfast.split(",").map((s) => s.trim()).filter(Boolean),
            lunch:     rounds.lunch.split(",").map((s) => s.trim()).filter(Boolean),
            dinner:    rounds.dinner.split(",").map((s) => s.trim()).filter(Boolean),
          })}
          loading={saving === "rounds"}
        />
      </Card>

      <Card className="p-5">
        <Section icon={QrCode} title="UPI merchant" desc="VPA used for wallet recharge QR codes." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="UPI VPA"       value={payments.upi_vpa}       onChange={(v) => setPayments({ ...payments, upi_vpa:       String(v) })} />
          <Field label="Merchant name" value={payments.merchant_name} onChange={(v) => setPayments({ ...payments, merchant_name: String(v) })} />
        </div>
        <SaveBtn onClick={() => save("payments", payments)} loading={saving === "payments"} />
      </Card>

      <Card className="p-5">
        <Section icon={Sliders} title="Feature flags" desc="Toggle app features on/off for all users instantly." />
        <div className="mt-4 space-y-3">
          {([
            { key: "wallet_topup",       label: "Wallet top-up",       desc: "Users can recharge their wallet" },
            { key: "referrals",          label: "Referral program",    desc: "Refer-a-friend with wallet reward" },
            { key: "loyalty",            label: "Loyalty rewards",     desc: "Points / streak rewards" },
            { key: "support",            label: "In-app support",      desc: "Help & support chat / tickets" },
            { key: "rider_tracking",     label: "Live rider tracking", desc: "Map view of rider en route" },
            { key: "push_notifications", label: "Push notifications",  desc: "Send browser / PWA push alerts" },
          ] as const).map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <Switch
                checked={!!features[key as keyof typeof features]}
                onCheckedChange={(v) => setFeatures({ ...features, [key]: v })}
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field
              label="Referral reward (₹ per user)"
              value={features.referral_reward_amount}
              onChange={(v) => setFeatures({ ...features, referral_reward_amount: Number(v) })}
            />
            <Field
              label="Monthly referral cap (per user)"
              value={features.monthly_referral_cap}
              onChange={(v) => setFeatures({ ...features, monthly_referral_cap: Number(v) })}
            />
          </div>
        </div>
        <SaveBtn onClick={() => save("features", features)} loading={saving === "features"} />
      </Card>
    </div>
  );
}

function Section({ icon: Icon, title, desc }: any) {
  return (
    <div className="flex items-start gap-3">
      <span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: any; onChange: (v: any) => void }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input className="mt-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SaveBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div className="mt-4 flex justify-end">
      <Button size="sm" onClick={onClick} disabled={loading}>
        <Save className="mr-1.5 h-3.5 w-3.5" /> {loading ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
