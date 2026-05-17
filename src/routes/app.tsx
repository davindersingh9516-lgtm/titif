import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/customer/BottomNav";
import { PageTransition } from "@/components/ui/page-transition";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, isAdmin, roles } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user)                       { nav({ to: "/login" }); return; }
    if (isAdmin)                     { nav({ to: "/admin" }); return; }
    if (roles.includes("rider"))     { nav({ to: "/rider" }); return; }
  }, [user, loading, isAdmin, roles, nav]);

  // Customer app keeps the phone-frame shell on desktop. Admin/super stay full-width.
  useEffect(() => {
    const el = typeof document !== "undefined" ? document.getElementById("app-shell") : null;
    el?.classList.add("shell-mobile");
    return () => el?.classList.remove("shell-mobile");
  }, []);

  if (loading || !user || isAdmin) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <div className="text-xs text-muted-foreground">Loading your kitchen…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh pb-20">
      <PageTransition>
        <Outlet />
      </PageTransition>
      <BottomNav />
    </div>
  );
}
