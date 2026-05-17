import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/customer/AppHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: ["notifications-all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id,type,title,body,link,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as Notification[];
    },
  });

  const { data: prefs } = useQuery({
    queryKey: ["notif-prefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const [whatsapp, setWhatsapp] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [threshold, setThreshold] = useState("100");

  useEffect(() => {
    if (prefs) {
      setWhatsapp(prefs.whatsapp);
      setInApp(prefs.in_app);
      setThreshold(String(prefs.low_balance_threshold ?? 100));
    }
  }, [prefs]);

  const savePrefs = async () => {
    if (!user) return;
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: user.id,
      whatsapp,
      in_app: inApp,
      low_balance_threshold: Number(threshold) || 100,
      updated_at: new Date().toISOString(),
    });
    if (error) toast.error(error.message);
    else toast.success("Preferences saved");
    qc.invalidateQueries({ queryKey: ["notif-prefs", user.id] });
  };

  const markAll = async () => {
    await supabase.rpc("mark_all_notifications_read");
    qc.invalidateQueries({ queryKey: ["notifications-all", user?.id] });
    qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div>
      <AppHeader title="Notifications" back="/app" />
      <div className="px-4 py-4 space-y-5">
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold">Preferences</div>
          <div className="flex items-center justify-between">
            <Label htmlFor="in_app" className="text-sm font-normal">In-app notifications</Label>
            <Switch id="in_app" checked={inApp} onCheckedChange={setInApp} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="wa" className="text-sm font-normal">WhatsApp updates</Label>
            <Switch id="wa" checked={whatsapp} onCheckedChange={setWhatsapp} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="thr" className="text-sm font-normal">Low balance alert at (₹)</Label>
            <Input id="thr" type="number" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
          <Button size="sm" onClick={savePrefs} className="w-full bg-gradient-primary">Save preferences</Button>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Recent</div>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-primary">Mark all read</button>
            )}
          </div>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No notifications yet.</div>
            ) : (
              items.map((n) => {
                const Inner = (
                  <div className={`flex flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-sm last:border-0 ${n.read_at ? "bg-background" : "bg-accent/40"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium leading-snug">{n.title}</div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </div>
                    </div>
                    {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} to={n.link} className="block" onClick={async () => { await supabase.rpc("mark_notification_read", { p_id: n.id }); qc.invalidateQueries({ queryKey: ["notifications-all", user?.id] }); }}>
                    {Inner}
                  </Link>
                ) : (
                  <div key={n.id}>{Inner}</div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
