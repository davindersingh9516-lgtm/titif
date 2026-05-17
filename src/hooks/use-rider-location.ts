import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RiderPosition = {
  lat: number;
  lng: number;
  name?: string | null;
  phone?: string | null;
  lastSeenAt?: string | null;
};

/**
 * Subscribes to a rider's live position via Supabase Realtime.
 * Hydrates from REST first, then patches in-memory on every postgres
 * change to `riders.id = riderId`. Cleans up the channel on unmount.
 */
export function useRiderLocation(riderId: string | null | undefined) {
  const [pos, setPos] = useState<RiderPosition | null>(null);

  useEffect(() => {
    if (!riderId) {
      setPos(null);
      return;
    }
    let alive = true;

    (async () => {
      const { data } = await supabase
        .from("riders")
        .select("name, phone, current_lat, current_lng, last_seen_at")
        .eq("id", riderId)
        .maybeSingle();
      if (alive && data?.current_lat != null && data.current_lng != null) {
        setPos({
          lat: Number(data.current_lat),
          lng: Number(data.current_lng),
          name: data.name,
          phone: data.phone,
          lastSeenAt: data.last_seen_at,
        });
      }
    })();

    const ch = supabase
      .channel(`rider-pos:${riderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "riders", filter: `id=eq.${riderId}` },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const lat = Number(r.current_lat);
          const lng = Number(r.current_lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          setPos({
            lat,
            lng,
            name: (r.name as string) ?? null,
            phone: (r.phone as string) ?? null,
            lastSeenAt: (r.last_seen_at as string) ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [riderId]);

  return pos;
}

/** Haversine distance in metres between two lat/lng points. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimate ETA minutes assuming an average urban scooter speed of 22 km/h. */
export function etaMinutes(meters: number, avgKmh = 22) {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  return Math.max(1, Math.round((meters / 1000 / avgKmh) * 60));
}
