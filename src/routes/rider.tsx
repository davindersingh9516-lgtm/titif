import { createFileRoute, Outlet, useNavigate, Link, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bike, ListChecks, LogOut, Power } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/rider")({
  component: RiderLayout,
});

function RiderLayout() {
  const { user, roles, loading, signOut, isAdmin } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const isRider = roles.includes("rider") || isAdmin;

  useEffect(() => {
    if (loading) return;
    if (!user) nav({ to: "/login" });
    else if (!isRider) nav({ to: "/app" });
  }, [user, isRider, loading, nav]);

  const { data: rider } = useQuery({
    enabled: !!user,
    queryKey: ["rider-self", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("riders").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  // Heartbeat: stream geolocation every 20s while online
  useEffect(() => {
    if (!rider?.online || typeof navigator === "undefined" || !navigator.geolocation) return;
    let alive = true;
    const tick = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!alive) return;
          supabase.rpc("rider_heartbeat", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 },
      );
    tick();
    const id = setInterval(tick, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [rider?.online]);

  const toggleOnline = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_rider_online", { p_online: !rider?.online });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rider-self"] }),
  });

  if (loading || !isRider) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const onDetail = loc.pathname.startsWith("/rider/d/");

  return (
    <div className="min-h-svh bg-background pb-20">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/90 px-4 py-3 backdrop-blur safe-top">
        <Link to="/rider" className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/10 p-1.5"><Bike className="h-4 w-4 text-primary" /></div>
          <span className="text-sm font-bold tracking-tight">Rider</span>
        </Link>
        <div className="flex items-center gap-2">
          {rider && (
            <button
              onClick={() => toggleOnline.mutate()}
              disabled={toggleOnline.isPending}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                rider.online ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              {rider.online ? "Online" : "Offline"}
            </button>
          )}
          <Button size="sm" variant="ghost" onClick={async () => { await signOut(); nav({ to: "/" }); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-4">
        <Outlet />
      </main>
      {!onDetail && (
        <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl justify-around border-t border-border bg-card/95 py-2 safe-bottom">
          <Link to="/rider" className="flex flex-col items-center gap-0.5 px-4 py-1 text-xs font-medium">
            <ListChecks className="h-5 w-5" />
            Deliveries
          </Link>
        </nav>
      )}
    </div>
  );
}
