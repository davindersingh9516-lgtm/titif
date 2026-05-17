import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Called by pg_cron every 5 min. Auto-locks 'placed' orders past cutoff
// into 'preparing' so the kitchen takes over.
export const Route = createFileRoute("/api/public/hooks/lock-orders")({
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
        const sb = createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data, error } = await sb.rpc("lock_orders_past_cutoff");
        if (error) {
          console.error("[lock-orders]", error);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, locked: data ?? 0, at: new Date().toISOString() });
      },
    },
  },
});
