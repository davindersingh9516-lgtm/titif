import { useEffect, useRef } from "react";
import Map, { Layer, Marker, Source } from "react-map-gl/mapbox";
import type { LayerProps, MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { Bike, MapPin, Navigation2, Phone, Radio } from "lucide-react";
import { distanceMeters, etaMinutes, useRiderLocation } from "@/hooks/use-rider-location";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

const routeLayer: LayerProps = {
  id: "route",
  type: "line",
  paint: {
    "line-color": "#f97316",
    "line-width": 3.5,
    "line-dasharray": [1.5, 1.5],
    "line-opacity": 0.9,
  },
};

type Props = {
  riderId: string | null | undefined;
  destLat: number | null | undefined;
  destLng: number | null | undefined;
  destAddress: string;
  status: string;
};

export function LiveTrackCard({ riderId, destLat, destLng, destAddress, status }: Props) {
  const pos = useRiderLocation(riderId ?? null);
  const mapRef = useRef<MapRef>(null);

  const hasDest = destLat != null && destLng != null;
  const dist = pos && hasDest ? distanceMeters(pos, { lat: destLat!, lng: destLng! }) : null;
  const eta = dist != null ? etaMinutes(dist) : null;
  const stale = pos?.lastSeenAt
    ? Date.now() - new Date(pos.lastSeenAt).getTime() > 60_000
    : false;

  const mapsUrl = hasDest
    ? `https://www.google.com/maps/search/?api=1&query=${destLat},${destLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destAddress)}`;

  // Auto-fit map bounds whenever rider or destination position changes
  useEffect(() => {
    if (!mapRef.current || !pos || !hasDest) return;
    mapRef.current.fitBounds(
      [
        [Math.min(pos.lng, destLng!), Math.min(pos.lat, destLat!)],
        [Math.max(pos.lng, destLng!), Math.max(pos.lat, destLat!)],
      ],
      { padding: 64, duration: 800, maxZoom: 16 },
    );
  }, [pos?.lat, pos?.lng, destLat, destLng]);

  const routeGeoJSON =
    pos && hasDest
      ? {
          type: "FeatureCollection" as const,
          features: [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: [
                  [pos.lng, pos.lat],
                  [destLng!, destLat!],
                ],
              },
              properties: {},
            },
          ],
        }
      : null;

  const initialLng = pos?.lng ?? destLng ?? 77.2;
  const initialLat = pos?.lat ?? destLat ?? 28.6;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative h-56">
        {/* Live badge */}
        <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-semibold shadow backdrop-blur">
          <Radio className={`h-3 w-3 ${pos && !stale ? "text-emerald-500" : "text-muted-foreground"}`} />
          {pos ? (stale ? "Signal weak" : "Live") : "Offline"}
        </div>

        {eta != null && status !== "delivered" && (
          <div className="absolute bottom-3 left-3 z-10 rounded-full bg-card/95 px-3 py-1 text-xs font-bold shadow backdrop-blur">
            ETA · {eta} min
          </div>
        )}
        {dist != null && status !== "delivered" && (
          <div className="absolute bottom-3 right-3 z-10 rounded-full bg-card/95 px-3 py-1 text-xs font-semibold shadow backdrop-blur">
            {dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`}
          </div>
        )}

        {TOKEN ? (
          <Map
            ref={mapRef}
            mapboxAccessToken={TOKEN}
            initialViewState={{ longitude: initialLng, latitude: initialLat, zoom: 14 }}
            style={{ width: "100%", height: "100%" }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            attributionControl={false}
            scrollZoom={false}
          >
            {/* Dashed route line */}
            {routeGeoJSON && (
              <Source id="route" type="geojson" data={routeGeoJSON}>
                <Layer {...routeLayer} />
              </Source>
            )}

            {/* Destination pin */}
            {hasDest && (
              <Marker longitude={destLng!} latitude={destLat!} anchor="bottom">
                <MapPin className="h-9 w-9 text-red-500 drop-shadow-lg" />
              </Marker>
            )}

            {/* Rider with pulsing ring */}
            {pos && (
              <Marker longitude={pos.lng} latitude={pos.lat} anchor="center">
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-12 w-12 animate-ping rounded-full bg-orange-400/30" />
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 shadow-lg ring-2 ring-white dark:ring-zinc-900">
                    <Bike className="h-4 w-4 text-white" />
                  </div>
                </div>
              </Marker>
            )}
          </Map>
        ) : (
          <NoTokenFallback pos={pos} status={status} />
        )}

        {/* Delivered overlay */}
        {status === "delivered" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/70 backdrop-blur-sm">
            <div className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-white shadow-lg">
              Delivered ✓
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <span className="line-clamp-2">{destAddress}</span>
        </div>
        <div className="flex gap-2">
          {pos?.phone && (
            <a
              href={`tel:${pos.phone}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-input bg-background py-2 text-sm font-semibold"
            >
              <Phone className="h-4 w-4" /> Call rider
            </a>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-primary py-2 text-sm font-semibold text-primary-foreground shadow-glow"
          >
            <Navigation2 className="h-4 w-4" /> Open in Maps
          </a>
        </div>
        {pos && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Bike className="h-3 w-3" />
            <span>{pos.name ?? "Rider"} is on the way</span>
          </div>
        )}
      </div>
    </div>
  );
}

function NoTokenFallback({
  pos,
  status,
}: {
  pos: ReturnType<typeof useRiderLocation>;
  status: string;
}) {
  return (
    <div className="relative h-full bg-gradient-to-br from-emerald-50 via-amber-50 to-orange-50 dark:from-emerald-950/30 dark:via-amber-950/20 dark:to-orange-950/30">
      <svg className="absolute inset-0 h-full w-full opacity-[0.18]" aria-hidden>
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm text-foreground/60">
        <span>{status === "delivered" ? "Delivered ✓" : pos ? "Rider is on the way" : "Waiting for rider…"}</span>
        <span className="text-[11px] text-muted-foreground">Add VITE_MAPBOX_TOKEN for live map</span>
      </div>
    </div>
  );
}
