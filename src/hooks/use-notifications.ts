import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Realtime in-app notifications for the signed-in user.
 * Subscribes to INSERT events on `public.notifications` filtered by user_id,
 * shows a toast for fresh items, and keeps the cached list in sync.
 */
export function useNotifications(limit = 30) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,type,title,body,link,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notifications:user:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as Notification;
          toast(n.title, { description: n.body ?? undefined });
          qc.invalidateQueries({ queryKey: ["notifications", user.id, limit] });
          qc.invalidateQueries({ queryKey: ["notifications-unread", user.id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications", user.id, limit] });
          qc.invalidateQueries({ queryKey: ["notifications-unread", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc, limit]);

  const items = query.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const markRead = async (id: string) => {
    await supabase.rpc("mark_notification_read", { p_id: id });
    qc.invalidateQueries({ queryKey: ["notifications", user?.id, limit] });
  };
  const markAllRead = async () => {
    await supabase.rpc("mark_all_notifications_read");
    qc.invalidateQueries({ queryKey: ["notifications", user?.id, limit] });
  };

  return { ...query, items, unread, markRead, markAllRead };
}

/**
 * Live unread count, also realtime via the per-user notifications channel.
 * Cheaper than fetching the full list when only the badge is needed.
 */
export function useUnreadCount() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications-unread", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("unread_notifications_count");
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notifications-unread:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["notifications-unread", user.id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  return query;
}
