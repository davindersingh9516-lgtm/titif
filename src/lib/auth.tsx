import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "super_admin" | "admin" | "rider" | "customer";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: Role[];
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** Mock OTP: phone -> request OTP. In dev returns immediately. */
  requestOtp: (phone: string) => Promise<void>;
  /** Mock OTP: any 6-digit code accepted. Creates user if needed. */
  verifyOtp: (phone: string, code: string) => Promise<void>;
  /** Email + password login */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Email + password sign-up (then auto sign-in if confirmation off) */
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  /** Send 6-digit OTP to email via Supabase */
  requestEmailOtp: (email: string) => Promise<void>;
  /** Verify email OTP */
  verifyEmailOtp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const phoneToEmail = (phone: string) => `u${phone.replace(/\D/g, "")}@tiffin.local`;
const phoneToPassword = (phone: string) => `tiffin_${phone.replace(/\D/g, "")}_dev`;

function parseDeviceLabel(ua: string): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${br}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          // Roles may change on sign-in — reload them.
          setLoading(true);
          loadRoles(s.user.id).then(() => { if (mounted) setLoading(false); }).catch(() => { if (mounted) setLoading(false); });
        }
        // TOKEN_REFRESHED: user/roles haven't changed, skip reload.
      } else {
        setRoles([]);
        setLoading(false);
      }
    });

    // Initial hydration: wait for roles before clearing loading.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadRoles(data.session.user.id).catch(() => {});
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadRoles = async (uid: string): Promise<void> => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles((data ?? []).map((r) => r.role as Role));
  };

  const requestOtp = async (_phone: string) => {
    // Dev mock — no SMS sent. Pretend to succeed.
    await new Promise((r) => setTimeout(r, 400));
  };

  const verifyOtp = async (phone: string, code: string) => {
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code");
    const email = phoneToEmail(phone);
    const password = phoneToPassword(phone);
    // Try sign in; if user doesn't exist, sign up.
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const { error: signupErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { phone } },
      });
      if (signupErr) throw signupErr;
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (loginErr) throw loginErr;
      // Save phone on profile
      const u = (await supabase.auth.getUser()).data.user;
      if (u) await supabase.from("profiles").update({ phone }).eq("id", u.id);
    }
    // Record device session (best-effort)
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const label = parseDeviceLabel(ua);
      const { data: sid } = await supabase.rpc("record_session", {
        p_device_label: label,
        p_user_agent: ua,
        p_ip: null as unknown as string,
      });
      if (sid && typeof window !== "undefined") {
        localStorage.setItem("tiffin_session_id", sid as unknown as string);
      }
    } catch {
      /* non-fatal */
    }
  };

  const recordDeviceSession = async () => {
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const label = parseDeviceLabel(ua);
      const { data: sid } = await supabase.rpc("record_session", {
        p_device_label: label,
        p_user_agent: ua,
        p_ip: null as unknown as string,
      });
      if (sid && typeof window !== "undefined") {
        localStorage.setItem("tiffin_session_id", sid as unknown as string);
      }
    } catch {
      /* non-fatal */
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await recordDeviceSession();
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const redirectUrl = typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl },
    });
    if (error) throw error;
    // Try immediate sign-in (works if email confirmation is disabled)
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (!signInErr) await recordDeviceSession();
  };

  const requestEmailOtp = async (email: string) => {
    // NOTE: Do NOT pass emailRedirectTo — that triggers magic link mode.
    // Without it, Supabase sends a 6-digit OTP token via the email template.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  };

  const verifyEmailOtp = async (email: string, code: string) => {
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code");
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw error;
    await recordDeviceSession();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // Signal main.mobile.tsx to remove the loading overlay only after auth is
  // fully settled. Without this, the overlay disappears while AuthProvider is
  // still running getSession() + loadRoles(), and a user tapping the first
  // input triggers IME handling while the JS thread is still busy → freeze.
  useEffect(() => {
    if (!loading) {
      console.error("[T] auth loading:false → dispatching tiffin:ready");
      window.dispatchEvent(new CustomEvent("tiffin:ready"));
    }
  }, [loading]);

  const ctxValue = useMemo(() => ({
    user,
    session,
    roles,
    loading,
    isAdmin: roles.includes("admin") || roles.includes("super_admin"),
    isSuperAdmin: roles.includes("super_admin"),
    requestOtp,
    verifyOtp,
    signInWithEmail,
    signUpWithEmail,
    requestEmailOtp,
    verifyEmailOtp,
    signOut,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, session, roles, loading]);

  return <Ctx.Provider value={ctxValue}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
