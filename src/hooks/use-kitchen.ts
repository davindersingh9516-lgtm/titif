import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MealType = "breakfast" | "lunch" | "dinner";

export const todayIST = () =>
  new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Aggregate KPIs for the kitchen day (orders, mini/large/breakfast counts, prep funnel). */
export function useKitchenPlan(date: string, meal: MealType | null) {
  return useQuery({
    queryKey: ["kitchen-plan", date, meal],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kitchen_plan", {
        p_date: date,
        p_meal: meal as any,
      });
      if (error) throw error;
      return data as any;
    },
  });
}

/** Per-order kitchen view with itemised mini/large/fixed counts, prep status, batch link. */
export function useKitchenOrders(date: string, meal: MealType | null) {
  return useQuery({
    queryKey: ["kitchen-orders", date, meal],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kitchen_today_orders", {
        p_date: date,
        p_meal: meal as any,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useKitchenBatches(date: string) {
  return useQuery({
    queryKey: ["kitchen-batches", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kitchen_batches")
        .select("*")
        .eq("delivery_date", date)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Realtime sync — invalidates kitchen queries on any orders/batch/delivery change. */
export function useKitchenRealtime(date: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel(`kitchen-rt-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        qc.invalidateQueries({ queryKey: ["kitchen-plan", date] });
        qc.invalidateQueries({ queryKey: ["kitchen-orders", date] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_batches" }, () => {
        qc.invalidateQueries({ queryKey: ["kitchen-batches", date] });
        qc.invalidateQueries({ queryKey: ["kitchen-plan", date] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => {
        qc.invalidateQueries({ queryKey: ["kitchen-orders", date] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [date, qc]);
}

/* ──────────────── Mutations ──────────────── */

export function useSetOrderPrep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { order_id: string; status: "pending" | "prepping" | "packed" | "ready" }) => {
      const { error } = await supabase.rpc("kitchen_set_order_prep", {
        p_order_id: args.order_id,
        p_status: args.status,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen-orders"] }),
  });
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      date: string;
      meal: MealType;
      round?: string;
      window?: "round1" | "round2" | null;
    }) => {
      const { data, error } = await supabase.rpc("kitchen_create_batch", {
        p_date: args.date,
        p_meal: args.meal,
        p_round: args.round ?? "R1",
        p_window: (args.window ?? null) as any,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen-batches"] });
      qc.invalidateQueries({ queryKey: ["kitchen-plan"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
    },
  });
}

export function useSetBatchStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { batch_id: string; status: "planned" | "packing" | "ready" | "dispatched" }) => {
      const { error } = await supabase.rpc("kitchen_set_batch_status", {
        p_batch_id: args.batch_id,
        p_status: args.status,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen-batches"] }),
  });
}

export function useDispatchBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { batch_id: string; rider_id: string }) => {
      const { data, error } = await supabase.rpc("kitchen_dispatch_batch", {
        p_batch_id: args.batch_id,
        p_rider_id: args.rider_id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen-batches"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-plan"] });
    },
  });
}

export function useMealToggle() {
  return useMutation({
    mutationFn: async (args: { date: string; meal: MealType; open: boolean; note?: string }) => {
      const { error } = await supabase.rpc("kitchen_meal_toggle", {
        p_date: args.date,
        p_meal: args.meal,
        p_open: args.open,
        p_note: args.note ?? undefined,
      });
      if (error) throw error;
    },
  });
}
