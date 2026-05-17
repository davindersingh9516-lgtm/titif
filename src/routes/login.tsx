import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { ChevronLeft, Mail, Lock, Phone, Clock } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Tab = "email" | "mobile";
type EmailMode = "password" | "otp";
type EmailStep = "enter" | "otp";

function LoginPage() {
  const { signInWithEmail, signUpWithEmail, requestEmailOtp, verifyEmailOtp } = useAuth();
  const nav = useNavigate();

  const [tab, setTab] = useState<Tab>("email");
  const [mode, setMode] = useState<EmailMode>("password");
  const [step, setStep] = useState<EmailStep>("enter");
  const [isSignup, setIsSignup] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedEmail, setSavedEmail] = useState(""); // OTP step ke liye email preserve

  // Uncontrolled refs — no React re-render on typing
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Auto-focus email on mount so IME IPC is established before user taps.
  // Delay lets the page render first; with adjustPan the email field sits
  // above the keyboard so no viewport pan occurs.
  useEffect(() => {
    const t = setTimeout(() => emailRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const submitPassword = async () => {
    const email = emailRef.current?.value.trim() ?? "";
    const password = passwordRef.current?.value ?? "";
    if (!validEmail(email)) return toast.error("Enter a valid email");
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    try {
      if (isSignup) {
        await signUpWithEmail(email, password);
        toast.success("Account created");
      } else {
        await signInWithEmail(email, password);
      }
      nav({ to: "/" });
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const sendEmailOtp = async () => {
    const email = emailRef.current?.value.trim() ?? "";
    if (!validEmail(email)) return toast.error("Enter a valid email");
    setBusy(true);
    try {
      await requestEmailOtp(email);
      setSavedEmail(email); // step change se pehle save karo — ref unmount ho jaata hai
      setStep("otp");
      toast.success("OTP sent — check your inbox");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    try {
      await verifyEmailOtp(savedEmail, code);
      nav({ to: "/" });
    } catch (e: any) {
      toast.error(e.message ?? "Invalid OTP");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-svh bg-gradient-hero px-6 pt-10 safe-top">
      <button
        onClick={() => step === "otp" ? setStep("enter") : history.back()}
        className="-ml-2 rounded-full p-2 hover:bg-accent"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="mt-8">
        <h1 className="text-2xl font-bold tracking-tight">Welcome to Tiffin</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Sign in to order your daily meals.</p>
      </div>

      {/* Plain tab buttons — no Radix, no tabIndex conflict */}
      <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        <button
          onClick={() => setTab("email")}
          className={`rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "email" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          Email
        </button>
        <button
          onClick={() => setTab("mobile")}
          className={`rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "mobile" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          Mobile OTP
        </button>
      </div>

      {/* EMAIL TAB */}
      {tab === "email" && (
        <div className="mt-6">
          {step === "enter" ? (
            <div className="space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2 rounded-lg bg-muted p-1">
                <button
                  onClick={() => setMode("password")}
                  className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                    mode === "password" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Password
                </button>
                <button
                  onClick={() => setMode("otp")}
                  className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                    mode === "otp" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Email OTP
                </button>
              </div>

              {/* Email input */}
              <div className="flex items-center gap-2 rounded-2xl border-2 border-input bg-card p-3 focus-within:border-primary">
                <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  ref={emailRef}
                  type="text"
                  inputMode="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                />
              </div>

              {mode === "password" && (
                <>
                  <div className="flex items-center gap-2 rounded-2xl border-2 border-input bg-card p-3 focus-within:border-primary">
                    <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <input
                      ref={passwordRef}
                      type="password"
                      placeholder="Password"
                      autoComplete="current-password"
                      className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                    />
                  </div>

                  <Button
                    onClick={submitPassword}
                    disabled={busy}
                    size="lg"
                    className="h-12 w-full bg-gradient-primary text-base shadow-glow"
                  >
                    {isSignup ? "Create account" : "Sign in"}
                  </Button>

                  <button
                    onClick={() => setIsSignup((v) => !v)}
                    className="block w-full text-center text-sm text-muted-foreground"
                  >
                    {isSignup ? "Already have an account? Sign in" : "New here? Create an account"}
                  </button>
                </>
              )}

              {mode === "otp" && (
                <Button
                  onClick={sendEmailOtp}
                  disabled={busy}
                  size="lg"
                  className="h-12 w-full bg-gradient-primary text-base shadow-glow"
                >
                  Send OTP to email
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                6-digit code sent to{" "}
                <span className="font-medium text-foreground">{savedEmail}</span>
              </p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                onClick={verifyOtp}
                disabled={busy || code.length !== 6}
                size="lg"
                className="h-12 w-full bg-gradient-primary text-base shadow-glow"
              >
                Verify & continue
              </Button>
              <button
                onClick={sendEmailOtp}
                disabled={busy}
                className="block w-full text-center text-sm text-muted-foreground"
              >
                Resend OTP
              </button>
            </div>
          )}
        </div>
      )}

      {/* MOBILE TAB */}
      {tab === "mobile" && (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-input bg-card/50 p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-7 w-7 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Mobile OTP login</h3>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Coming soon
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            We're rolling out SMS OTP shortly. For now, please use email to sign in.
          </p>
        </div>
      )}
    </div>
  );
}
