import { useCallback, useEffect, useRef, useState } from "react";
import Map, { type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Navigation, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export type LocationResult = { lat: number; lng: number; address: string };

type Props = {
  initialLat?: number | null;
  initialLng?: number | null;
  initialAddress?: string;
  onConfirm: (r: LocationResult) => void;
};

async function reverseGeocode(lng: number, lat: number): Promise<string> {
  if (!TOKEN) return "";
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${TOKEN}&language=en&country=IN&types=address,place,neighborhood,locality&limit=1`
    );
    const json = await res.json();
    return (json.features?.[0]?.place_name as string) ?? "";
  } catch {
    return "";
  }
}

const DEFAULT = { lat: 28.6139, lng: 77.209 }; // New Delhi fallback

export function LocationPicker({ initialLat, initialLng, initialAddress, onConfirm }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [center, setCenter] = useState({
    lat: initialLat ?? DEFAULT.lat,
    lng: initialLng ?? DEFAULT.lng,
  });
  const [address, setAddress] = useState(initialAddress ?? "");
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const geoTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-get current location on mount (if no initial location)
  useEffect(() => {
    if (initialLat && initialLng) return;
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCenter({ lat: latitude, lng: longitude });
        mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 17, duration: 800 });
        setLocating(false);
        triggerGeocode(longitude, latitude);
      },
      () => setLocating(false),
      { timeout: 8000, enableHighAccuracy: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerGeocode = useCallback((lng: number, lat: number) => {
    clearTimeout(geoTimeout.current);
    geoTimeout.current = setTimeout(async () => {
      setGeocoding(true);
      const addr = await reverseGeocode(lng, lat);
      if (addr) setAddress(addr);
      setGeocoding(false);
    }, 400);
  }, []);

  const handleMoveEnd = useCallback(() => {
    const c = mapRef.current?.getCenter();
    if (!c) return;
    setCenter({ lat: c.lat, lng: c.lng });
    triggerGeocode(c.lng, c.lat);
  }, [triggerGeocode]);

  const gotoCurrentLocation = () => {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCenter({ lat: latitude, lng: longitude });
        mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 17, duration: 600 });
        setLocating(false);
        triggerGeocode(longitude, latitude);
      },
      () => setLocating(false),
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  if (!TOKEN) {
    return (
      <div className="space-y-2">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="House no., street, area, city"
        />
        <Button
          size="sm"
          onClick={() => onConfirm({ lat: 0, lng: 0, address })}
          disabled={!address.trim()}
          className="w-full bg-gradient-primary"
        >
          <Check className="mr-1.5 h-4 w-4" /> Confirm address
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          Set VITE_MAPBOX_TOKEN in .env to enable map picker
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Map container */}
      <div className="relative h-64 w-full rounded-2xl overflow-hidden border border-border shadow-sm">
        <Map
          ref={mapRef}
          mapboxAccessToken={TOKEN}
          initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 16 }}
          style={{ width: "100%", height: "100%" }}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          onMoveEnd={handleMoveEnd}
          attributionControl={false}
        />

        {/* Fixed center pin */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative -mt-6">
            <div className="flex flex-col items-center">
              <MapPin className="h-9 w-9 fill-primary text-primary drop-shadow-lg" strokeWidth={1.5} />
              <div className="h-1.5 w-1.5 rounded-full bg-primary/40 blur-[2px] -mt-1" />
            </div>
          </div>
        </div>

        {/* Current location button */}
        <button
          onClick={gotoCurrentLocation}
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-md border border-border hover:bg-accent transition-colors"
        >
          {locating ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <Navigation className="h-5 w-5 text-primary" />
          )}
        </button>

        {/* Drag hint */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-card/90 px-3 py-1 text-xs font-medium shadow backdrop-blur-sm">
          Map ko drag karo apni location pe
        </div>
      </div>

      {/* Address text */}
      <div className="relative">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Delivery address"
          className="pr-8"
        />
        {geocoding && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <Button
        onClick={() => onConfirm({ lat: center.lat, lng: center.lng, address: address.trim() })}
        disabled={!address.trim()}
        className="w-full bg-gradient-primary"
      >
        <Check className="mr-1.5 h-4 w-4" /> Confirm location
      </Button>
    </div>
  );
}
