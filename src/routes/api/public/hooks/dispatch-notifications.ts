import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Called by pg_cron every minute. Drains the WhatsApp notification queue with
// retry + exponential backoff. Falls back to a no-op (marks "skipped") when
// WhatsApp Cloud API credentials are not yet configured so the queue stays clean.
export const Route = createFileRoute("/api/public/hooks/dispatch-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret) {
          const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
          if (bearer !== cronSecret) return new Response("unauthorized", { status: 401 });
        }

        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const waToken = process.env.WHATSAPP_TOKEN;
        const waPhoneId = process.env.WHATSAPP_PHONE_ID;

        const sb = createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: rows, error } = await sb.rpc("claim_pending_notifications", {
          p_limit: 25,
        });
        if (error) {
          console.error("[dispatch] claim error", error);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const pending = (rows ?? []) as Array<{
          id: string;
          to_phone: string | null;
          template: string;
          payload: Record<string, unknown>;
        }>;

        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const row of pending) {
          try {
            if (!row.to_phone) {
              await sb.rpc("mark_notification_failed", {
                p_id: row.id,
                p_error: "missing_phone",
              });
              failed += 1;
              continue;
            }

            // Soft mode: provider not configured yet — keep queue healthy.
            if (!waToken || !waPhoneId) {
              await sb.rpc("mark_notification_sent", {
                p_id: row.id,
                p_meta: { provider: "noop", reason: "whatsapp_not_configured" },
              });
              skipped += 1;
              continue;
            }

            const text = renderText(row.template, row.payload);
            const res = await fetch(
              `https://graph.facebook.com/v20.0/${waPhoneId}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${waToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to: row.to_phone.replace(/^\+/, ""),
                  type: "text",
                  text: { body: text },
                }),
              },
            );
            const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

            if (!res.ok) {
              await sb.rpc("mark_notification_failed", {
                p_id: row.id,
                p_error: `wa_${res.status}: ${JSON.stringify(body).slice(0, 240)}`,
              });
              failed += 1;
            } else {
              await sb.rpc("mark_notification_sent", {
                p_id: row.id,
                p_meta: { provider: "whatsapp", response: body },
              });
              sent += 1;
            }
          } catch (err) {
            await sb.rpc("mark_notification_failed", {
              p_id: row.id,
              p_error: (err as Error).message?.slice(0, 240) ?? "unknown",
            });
            failed += 1;
          }
        }

        return Response.json({
          ok: true,
          processed: pending.length,
          sent,
          failed,
          skipped,
          at: new Date().toISOString(),
        });
      },
    },
  },
});

function renderText(template: string, payload: Record<string, unknown>): string {
  const title = (payload.title as string) ?? "";
  const body = (payload.body as string) ?? "";
  const link = (payload.link as string) ?? "";
  const lines = [title && `*${title}*`, body, link && `Open: ${link}`].filter(Boolean);
  if (lines.length === 0) return `Update from Tiffin (${template})`;
  return lines.join("\n\n");
}
