import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { UtensilsCrossed, Clock, Wallet, MapPin } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading, isAdmin, roles } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (user) {
      if (isAdmin)                   nav({ to: "/admin" });
      else if (roles.includes("rider")) nav({ to: "/rider" });
      else                           nav({ to: "/app" });
    }
  }, [user, loading, isAdmin, roles, nav]);

  return (
    <div className="min-h-svh bg-gradient-hero">
      <div className="px-6 pt-14 pb-10 safe-top">
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow">
          <UtensilsCrossed className="h-6 w-6 text-primary-foreground" />
        </div>
        <h1 className="text-[34px] font-bold leading-tight tracking-tight">
          Fresh tiffin,
          <br />
          delivered on time.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Home-style breakfast, lunch and dinner. Order in seconds, pay from wallet, track live.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3">
          <Feature icon={Clock} title="On-time delivery" desc="Pick a 1-hour window. We're never late." />
          <Feature icon={Wallet} title="Wallet-first" desc="Add money once. Auto-pay every meal." />
          <Feature icon={MapPin} title="Live rider tracking" desc="See your tiffin on its way." />
        </div>

        <div className="mt-10 space-y-3">
          <Button asChild size="lg" className="w-full bg-gradient-primary text-primary-foreground shadow-glow h-12 text-base">
            <Link to="/login">Get started</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">Login with your phone — no password needed.</p>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: typeof Clock; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur">
      <div className="rounded-xl bg-accent p-2.5">
        <Icon className="h-5 w-5 text-accent-foreground" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}
