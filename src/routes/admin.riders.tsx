import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { Bike } from "lucide-react";

export const Route = createFileRoute("/admin/riders")({
  component: RidersAdmin,
});

function RidersAdmin() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const { data: riders } = useQuery({
    queryKey: ["riders"],
    queryFn: async () => {
      const { data } = await supabase.from("riders").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const add = async () => {
    if (!name) return;
    const { error } = await supabase.from("riders").insert({ name, phone, active: true });
    if (error) toast.error(error.message);
    else {
      setName(""); setPhone("");
      qc.invalidateQueries({ queryKey: ["riders"] });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Riders</h1>
      <Card className="mt-4 flex flex-wrap items-end gap-2 p-4">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-xs" />
        <Button onClick={add}>Add rider</Button>
      </Card>
      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {riders?.map((r) => (
          <Card key={r.id} className="space-y-2 p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-accent p-2.5"><Bike className="h-5 w-5" /></div>
              <div className="flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.phone || "—"} {r.user_id ? "· linked" : ""}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.online ? "bg-emerald-500/15 text-emerald-600" : r.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {r.online ? "Online" : r.active ? "Active" : "Off"}
              </span>
            </div>
            {!r.user_id && (
              <button
                onClick={async () => {
                  const p = prompt("Enter the rider's phone (must already have signed up once):", r.phone || "");
                  if (!p) return;
                  const { error } = await supabase.rpc("link_rider_to_phone", { p_rider_id: r.id, p_phone: p });
                  if (error) toast.error(error.message);
                  else { toast.success("Linked & rider role granted"); qc.invalidateQueries({ queryKey: ["riders"] }); }
                }}
                className="w-full rounded-lg border border-dashed border-input py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                Link to user account
              </button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
