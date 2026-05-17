import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function RatingPrompt({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const { data: existing } = useQuery({
    queryKey: ["rating", orderId],
    queryFn: async () => {
      const { data } = await supabase
        .from("order_ratings")
        .select("food_rating, rider_rating")
        .eq("order_id", orderId)
        .maybeSingle();
      return data;
    },
  });

  const [food, setFood] = useState(0);
  const [rider, setRider] = useState(0);
  const [busy, setBusy] = useState(false);

  if (existing) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
        <div className="font-semibold">Thanks for rating!</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Food {existing.food_rating}/5 · Rider {existing.rider_rating ?? "—"}/5
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (food < 1) {
      toast.error("Please rate the food");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("submit_order_rating", {
      p_order_id: orderId,
      p_food: food,
      p_rider: rider || undefined,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Thanks for your feedback");
      qc.invalidateQueries({ queryKey: ["rating", orderId] });
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">How was your order?</div>
      <Stars label="Food" value={food} onChange={setFood} />
      <Stars label="Rider" value={rider} onChange={setRider} />
      <Button onClick={submit} disabled={busy} className="mt-3 w-full rounded-xl">
        Submit rating
      </Button>
    </div>
  );
}

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="rounded-full p-1"
            aria-label={`${label} ${n} star`}
          >
            <Star className={`h-7 w-7 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
