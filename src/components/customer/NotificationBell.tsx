import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id,type,title,body,link,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      return (data ?? []) as Notification[];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as Notification;
          toast(n.title, { description: n.body ?? undefined });
          qc.invalidateQueries({ queryKey: ["notifications", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAll = async () => {
    await supabase.rpc("mark_all_notifications_read");
    qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  const open = async (id: string) => {
    await supabase.rpc("mark_notification_read", { p_id: id });
    qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`relative rounded-full p-2 transition-colors ${
            tone === "dark" ? "hover:bg-white/15" : "hover:bg-accent"
          }`}
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-sm font-semibold">Notifications</div>
          {unread > 0 && (
            <button onClick={markAll} className="text-xs font-medium text-primary">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</div>
          ) : (
            items.map((n) => {
              const Inner = (
                <div
                  className={`flex flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-sm last:border-0 ${
                    n.read_at ? "bg-background" : "bg-accent/40"
                  }`}
                >
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
                <Link key={n.id} to={n.link} onClick={() => open(n.id)} className="block">
                  {Inner}
                </Link>
              ) : (
                <button key={n.id} onClick={() => open(n.id)} className="block w-full text-left">
                  {Inner}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/app/notifications">View all</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
