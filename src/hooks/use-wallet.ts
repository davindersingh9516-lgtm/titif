import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Wallet balance + ledger with realtime sync.
 *
 * Subscribes to:
 *   - wallets:user:{uid}              (balance updates)
 *   - wallet_transactions:user:{uid}  (new ledger entries)
 *   - payments:user:{uid}             (status changes — pending → verified/failed)
 *
 * On any event we invalidate the relevant query so the UI re-renders without
 * a polling loop and without manual refetch().
 */
export function useWallet() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const wallet = useQuery({
    queryKey: ["wallet", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("balance, updated_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const transactions = useQuery({
    queryKey: ["wallet_tx", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const payments = useQuery({
    queryKey: ["payments", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`wallet:user:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["wallet", user.id] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["wallet_tx", user.id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["payments", user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  return {
    balance: Number(wallet.data?.balance ?? 0),
    walletLoading: wallet.isLoading,
    transactions: transactions.data ?? [],
    txLoading: transactions.isLoading,
    payments: payments.data ?? [],
    pendingPayment: (payments.data ?? []).find((p) => p.status === "pending"),
  };
}
