import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/customer/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { LogOut, ShieldCheck, Smartphone, MapPin, Pencil, Loader2 } from "lucide-react";
import type { LocationResult } from "@/components/customer/LocationPicker";

const LocationPicker = lazy(() =>
  import("@/components/customer/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, signOut, isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (profile) setName(profile.full_name ?? "");
  }, [profile]);

  const saveName = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["profile", user.id] }); }
  };

  const confirmLocation = async (r: LocationResult) => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ address: r.address, lat: r.lat || null, lng: r.lng || null })
      .eq("id", user.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Address saved");
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
    setEditingAddress(false);
  };

  return (
    <div>
      <AppHeader title="Profile" back="/app" />
      <div className="space-y-5 px-4 py-4">

        {/* Name */}
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            <Button onClick={saveName} disabled={busy} size="sm" className="shrink-0">Save</Button>
          </div>
        </div>

        {/* Phone (read-only) */}
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input value={profile?.phone ?? ""} disabled />
        </div>

        {/* Delivery address */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Delivery address</Label>
            {profile?.address && !editingAddress && (
              <button
                onClick={() => setEditingAddress(true)}
                className="flex items-center gap-1 text-xs font-medium text-primary"
              >
                <Pencil className="h-3 w-3" /> Change
              </button>
            )}
          </div>

          {/* Address display / picker */}
          {profileLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-accent/30 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : profile?.address && !editingAddress ? (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-accent/40 p-3">
              <MapPin className="mt-0.5 h-4 w-4 text-primary shrink-0" />
              <span className="text-sm leading-snug">{profile.address}</span>
            </div>
          ) : (
            <Suspense fallback={<div className="flex h-48 items-center justify-center text-muted-foreground">Loading map…</div>}>
              <LocationPicker
                initialLat={profile?.lat}
                initialLng={profile?.lng}
                initialAddress={profile?.address ?? ""}
                onConfirm={confirmLocation}
              />
            </Suspense>
          )}
        </div>

        {/* Admin panel link */}
        {isAdmin && (
          <Button variant="outline" onClick={() => nav({ to: "/admin" })} className="w-full gap-2">
            <ShieldCheck className="h-4 w-4" />
            Open Admin panel
          </Button>
        )}

        <Button variant="outline" onClick={() => nav({ to: "/app/sessions" })} className="w-full gap-2">
          <Smartphone className="h-4 w-4" /> Active sessions
        </Button>

        <Button
          variant="ghost"
          onClick={async () => { await signOut(); nav({ to: "/" }); }}
          className="w-full gap-2 text-destructive"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}
