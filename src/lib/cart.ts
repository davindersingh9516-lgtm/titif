import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  id: string;
  name: string;
  size: "mini" | "large" | "fixed";
  price: number;
  qty: number;
  meal_type: "breakfast" | "lunch" | "dinner";
};

interface CartState {
  items: CartItem[];
  add: (it: Omit<CartItem, "qty">) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  total: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (it) =>
        set((s) => {
          const ex = s.items.find((x) => x.id === it.id);
          if (ex) return { items: s.items.map((x) => (x.id === it.id ? { ...x, qty: x.qty + 1 } : x)) };
          return { items: [...s.items, { ...it, qty: 1 }] };
        }),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      setQty: (id, qty) =>
        set((s) => ({
          items: qty <= 0 ? s.items.filter((x) => x.id !== id) : s.items.map((x) => (x.id === id ? { ...x, qty } : x)),
        })),
      clear: () => set({ items: [] }),
      total: () => get().items.reduce((a, b) => a + b.price * b.qty, 0),
    }),
    { name: "tiffin-cart" },
  ),
);
