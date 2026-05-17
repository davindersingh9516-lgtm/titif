import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/support/$id")({
  component: TicketDetail,
});

function TicketDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: ticket } = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => {
      const { data } = await supabase.from("support_tickets").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["ticket-msgs", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticket_id", id)
        .order("created_at");
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`ticket:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages", filter: `ticket_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["ticket-msgs", id] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_tickets", filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["ticket", id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (body.trim().length < 1) return;
    setSending(true);
    const { error } = await supabase.rpc("add_support_message", { p_ticket_id: id, p_body: body.trim() });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setBody("");
  };

  const closed = ticket?.status === "resolved" || ticket?.status === "closed";

  return (
    <div className="flex h-svh flex-col">
      <div className="border-b border-border bg-card px-4 py-3 safe-top">
        <div className="flex items-center gap-2">
          <Link to="/app/support" className="rounded-full p-2 hover:bg-muted"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{ticket?.subject || "Ticket"}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">
                {String(ticket?.status ?? "").replace("_", " ")}
              </Badge>
              {ticket?.refund_amount && Number(ticket.refund_amount) > 0 ? (
                <span className="text-emerald-600">Refunded ₹{ticket.refund_amount}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/30 px-4 py-4">
        {messages?.map((m) => {
          const mine = m.author_id === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                  mine
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm bg-card text-card-foreground"
                }`}
              >
                {!mine && m.is_admin && (
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">Support</div>
                )}
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className="mt-1 text-[10px] opacity-60">
                  {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {closed ? (
        <div className="border-t border-border bg-card p-4 text-center text-xs text-muted-foreground safe-bottom">
          This ticket is {ticket?.status}. Open a new one if you need more help.
        </div>
      ) : (
        <div className="border-t border-border bg-card p-3 safe-bottom">
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message…"
              rows={1}
              maxLength={1000}
              className="min-h-[40px] resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <Button onClick={send} disabled={sending || body.trim().length < 1} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
