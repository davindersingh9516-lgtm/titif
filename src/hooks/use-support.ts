import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type SupportTicket = {
  id: string;
  user_id: string;
  order_id: string | null;
  subject: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
  resolution_note: string | null;
  refund_amount: number | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  is_admin: boolean;
  body: string;
  created_at: string;
};

/** Live list of the customer's own support tickets. */
export function useMyTickets() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["support-tickets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupportTicket[];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`support:user:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["support-tickets", user.id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  return query;
}

/** Live ticket detail + thread, with realtime message inserts. */
export function useTicket(ticketId: string | undefined) {
  const qc = useQueryClient();

  const ticket = useQuery({
    queryKey: ["support-ticket", ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("id", ticketId!)
        .maybeSingle();
      if (error) throw error;
      return data as SupportTicket | null;
    },
  });

  const messages = useQuery({
    queryKey: ["support-messages", ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SupportMessage[];
    },
  });

  useEffect(() => {
    if (!ticketId) return;
    const ch = supabase
      .channel(`ticket:${ticketId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_messages", filter: `ticket_id=eq.${ticketId}` },
        () => qc.invalidateQueries({ queryKey: ["support-messages", ticketId] }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_tickets", filter: `id=eq.${ticketId}` },
        () => qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ticketId, qc]);

  const sendMessage = async (body: string) => {
    if (!ticketId) return;
    const { error } = await supabase.rpc("add_support_message", { p_ticket_id: ticketId, p_body: body });
    if (error) throw error;
  };

  return { ticket, messages, sendMessage };
}

export type TicketCategory =
  | "order_issue" | "delivery_delayed" | "delivery_failed" | "delivery_wrong"
  | "payment_failed" | "recharge_issue" | "refund_request"
  | "wallet_not_updated" | "rider_issue" | "otp_issue" | "other";

/** Customer creates a ticket. Returns the new ticket id. */
export async function createTicket(args: {
  subject: string;
  category: TicketCategory;
  message: string;
  order_id?: string;
  priority?: "low" | "normal" | "high" | "urgent";
}) {
  const { data, error } = await supabase.rpc("create_support_ticket", {
    p_subject: args.subject,
    p_category: args.category,
    p_message: args.message,
    p_order_id: args.order_id,
    p_priority: args.priority ?? "normal",
  });
  if (error) throw error;
  return data as string;
}
