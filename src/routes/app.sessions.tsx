import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/customer/AppHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Smartphone, ShieldCheck, LogOut } from "lucide-react";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/app/sessions")({
  component: SessionsPage,
});

function SessionsPage() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const currentSid = typeof window !== "undefined" ? localStorage.getItem("tiffin_session_id") : null;

  const { data, isLoading } = useQuery({
    queryKey: ["sessions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_sessions")
        .select("*")
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("revoke_session", { p_session_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Session signed out");
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOutAll = async () => {
    const ok = await confirmDialog({
      title: "Sign out everywhere?",
      body: "You will be signed out from all devices immediately.",
      confirmLabel: "Sign out all",
      variant: "logout",
    });
    if (!ok) return;
    await supabase.auth.signOut({ scope: "global" });
    await signOut();
    window.location.href = "/login";
  };

  return (
    <div>
      <AppHeader title="Active sessions" back="/app/profile" />
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-start gap-2 rounded-2xl border border-border bg-card p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div className="text-sm text-muted-foreground">
            These are devices currently signed in to your account. Revoke any you don't recognise.
          </div>
        </div>

        {isLoading && <Skeleton className="h-20 w-full" />}

        {data?.map((s) => {
          const isCurrent = s.id === currentSid;
          return (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5"><Smartphone className="h-5 w-5 text-primary" /></div>
                <div>
                  <div className="text-sm font-medium">
                    {s.device_label ?? "Unknown device"}
                    {isCurrent && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">This device</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last active {formatDistanceToNow(new Date(s.last_seen_at), { addSuffix: true })}
                  </div>
                </div>
              </div>
              {!isCurrent && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} className="text-destructive">
                  Revoke
                </Button>
              )}
            </div>
          );
        })}

        {!isLoading && data?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No active sessions tracked yet.
          </div>
        )}

        <Button variant="outline" onClick={signOutAll} className="mt-4 w-full gap-2 text-destructive">
          <LogOut className="h-4 w-4" /> Sign out everywhere
        </Button>
      </div>
    </div>
  );
}
