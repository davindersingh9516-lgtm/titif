import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

type Role = "customer" | "rider" | "admin" | "super_admin";

interface RouteGuardProps {
  /** Required role(s). If omitted, only authentication is required. */
  require?: Role | Role[];
  /** Where to send unauthenticated users. Default: /login */
  loginRedirect?: string;
  /** Where to send authenticated users who lack the role. Default: /app */
  forbiddenRedirect?: string;
  /** Optional custom loading UI. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Centralised auth + role guard. Mirrors RLS rules on the client so users
 * never see a flash of forbidden content. Server-side enforcement still
 * happens via Supabase RLS + SECURITY DEFINER RPCs.
 */
export function RouteGuard({
  require,
  loginRedirect = "/login",
  forbiddenRedirect = "/app",
  fallback,
  children,
}: RouteGuardProps) {
  const { user, roles, loading, isAdmin, isSuperAdmin } = useAuth();
  const nav = useNavigate();

  const required = require ? (Array.isArray(require) ? require : [require]) : [];
  const hasRequired =
    required.length === 0 ||
    required.some((r) => {
      if (r === "admin") return isAdmin;
      if (r === "super_admin") return isSuperAdmin;
      return roles.includes(r);
    });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: loginRedirect });
    } else if (!hasRequired) {
      nav({ to: forbiddenRedirect });
    }
  }, [loading, user, hasRequired, nav, loginRedirect, forbiddenRedirect]);

  if (loading || !user || !hasRequired) {
    return (
      fallback ?? (
        <div className="flex min-h-svh items-center justify-center">
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <div className="h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <div className="text-xs text-muted-foreground">
              {loading ? "Restoring your session…" : !user ? "Redirecting to login…" : "Checking access…"}
            </div>
          </div>
        </div>
      )
    );
  }

  return <>{children}</>;
}
