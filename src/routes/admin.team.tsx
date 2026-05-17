import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldX, UserPlus } from "lucide-react";
import { useConfirm } from "@/hooks/use-confirm";

export const Route = createFileRoute("/admin/team")({
  component: TeamPage,
});

type AdminRow = {
  user_id: string;
  role: string;
  profiles: { full_name: string | null; phone: string | null } | null;
};

function TeamPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const [phone, setPhone] = useState("");

  const { data } = useQuery({
    queryKey: ["admin-team"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id, role, profiles:user_id(full_name, phone)")
        .in("role", ["admin", "super_admin"])
        .order("role");
      return (data ?? []) as unknown as AdminRow[];
    },
  });

  const grant = async () => {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return toast.error("Enter phone number");
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone", digits)
      .maybeSingle();
    if (!prof) return toast.error("No customer found with that phone");
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: prof.id, role: "admin" as any });
    if (error) toast.error(error.message);
    else {
      setPhone("");
      qc.invalidateQueries({ queryKey: ["admin-team"] });
      toast.success("Admin access granted");
    }
  };

  const revoke = async (userId: string, role: string, name: string | null) => {
    if (userId === user?.id) return toast.error("You cannot revoke your own access");
    const ok = await confirmDialog({
      title: `Revoke access from ${name ?? "this user"}?`,
      body: "They will lose admin access immediately.",
      confirmLabel: "Revoke",
      variant: "destructive",
    });
    if (!ok) return;
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role as any);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["admin-team"] });
      toast.success("Access revoked");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">Grant or revoke admin access for team members.</p>
      </div>

      {/* Grant form */}
      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4" /> Grant admin access
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <div className="mb-1 text-xs text-muted-foreground">Phone number</div>
            <Input
              placeholder="10-digit phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && grant()}
            />
          </div>
          <Button onClick={grant}>
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Grant
          </Button>
        </div>
      </Card>

      {/* Admins list */}
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Admins ({(data ?? []).length})
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(data ?? []).length === 0 && (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No admins yet
            </div>
          )}
          {(data ?? []).map((r) => (
            <Card key={r.user_id + r.role} className="flex items-center justify-between p-4">
              <div>
                <div className="font-semibold">{r.profiles?.full_name || "—"}</div>
                <div className="text-xs text-muted-foreground">{r.profiles?.phone || "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  admin
                </span>
                {r.user_id !== user?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => revoke(r.user_id, r.role, r.profiles?.full_name ?? null)}
                  >
                    <ShieldX className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
