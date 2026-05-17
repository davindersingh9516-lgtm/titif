import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ───────────── Types ───────────── */

export type AdminKpis = {
  orders_today: number; revenue_today: number; pending: number;
  out_for_delivery: number; delivered_today: number; cancelled_today: number;
  failed_today: number; riders_online: number; riders_active: number;
  customers_total: number; recharges_today: number; refunds_today: number;
};

export type DailyPoint = { day: string; orders: number; revenue: number };
export type MealMix = { meal_type: "breakfast" | "lunch" | "dinner"; orders: number; revenue: number };
export type TopCustomer = { user_id: string; full_name: string | null; phone: string | null; orders: number; spend: number };
export type RiderPerf = { rider_id: string; name: string; online: boolean; delivered: number; failed: number; avg_minutes: number };

/* ───────────── Queries ───────────── */

export function useAdminKpis(refetchMs = 30_000) {
  return useQuery({
    queryKey: ["analytics", "admin-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_kpis");
      if (error) throw error;
      return data as unknown as AdminKpis;
    },
    refetchInterval: refetchMs,
  });
}

export function useDailySeries(days = 14) {
  return useQuery({
    queryKey: ["analytics", "daily", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_daily_series", { p_days: days });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        day: new Date(r.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })) as DailyPoint[];
    },
  });
}

export function useMealMix(days = 7) {
  return useQuery({
    queryKey: ["analytics", "meal-mix", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_meal_mix", { p_days: days });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        meal_type: r.meal_type,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })) as MealMix[];
    },
  });
}

export function useTopCustomers(days = 30, limit = 10) {
  return useQuery({
    queryKey: ["analytics", "top-customers", days, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_top_customers", { p_days: days, p_limit: limit });
      if (error) throw error;
      return (data ?? []) as TopCustomer[];
    },
  });
}

export function useRiderPerformance(days = 7) {
  return useQuery({
    queryKey: ["analytics", "rider-perf", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_rider_performance", { p_days: days });
      if (error) throw error;
      return (data ?? []) as RiderPerf[];
    },
  });
}

export function useGrowthKpis() {
  return useQuery({
    queryKey: ["analytics", "growth"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_growth_kpis");
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: 60_000,
  });
}

export function useSupportKpis() {
  return useQuery({
    queryKey: ["analytics", "support"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_support_kpis");
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: 60_000,
  });
}

export function useSuperOverview() {
  return useQuery({
    queryKey: ["analytics", "super-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("super_overview");
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: 60_000,
  });
}

/** Single subscription that invalidates all analytics queries when ops data changes. */
export function useAnalyticsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("analytics-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        qc.invalidateQueries({ queryKey: ["analytics"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions" }, () => {
        qc.invalidateQueries({ queryKey: ["analytics", "admin-kpis"] });
        qc.invalidateQueries({ queryKey: ["analytics", "super-overview"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => {
        qc.invalidateQueries({ queryKey: ["analytics", "rider-perf"] });
        qc.invalidateQueries({ queryKey: ["analytics", "admin-kpis"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
}
