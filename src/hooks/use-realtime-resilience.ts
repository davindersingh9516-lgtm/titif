import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Production realtime resilience.
 *
 * - Listens for browser online/offline + visibilitychange events.
 * - On reconnect, forces a `realtime` channel resync and refetches all
 *   active queries so any postgres_changes events missed while the tab
 *   was offline are reconciled.
 * - Mount once at app root.
 */
export function useRealtimeResilience(disabled = false) {
  const qc = useQueryClient();
  const lastResync = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disabled) return;

    const resync = () => {
      const now = Date.now();
      // Ignore bursts within 5 seconds
      if (now - lastResync.current < 5_000) return;
      lastResync.current = now;
      try {
        supabase.realtime.disconnect();
        supabase.realtime.connect();
      } catch {
        /* noop */
      }
      // Only refetch queries that are actively mounted and already stale.
      // Using refetchType:"active" avoids waking up queries that are idle.
      qc.invalidateQueries({ refetchType: "active" });
    };

    const scheduleResync = () => {
      // Debounce: wait 300 ms so rapid online/visibility events collapse into one
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(resync, 300);
    };

    const onOnline = scheduleResync;
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleResync();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [qc]);
}
