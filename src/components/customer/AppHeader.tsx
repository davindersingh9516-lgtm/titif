import { Link } from "@tanstack/react-router";
import { ChevronLeft, ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";
import { NotificationBell } from "./NotificationBell";
import { useCart } from "@/lib/cart";

export function AppHeader({
  title,
  back,
  right,
  hideCart,
}: {
  title: string;
  back?: string;
  right?: ReactNode;
  hideCart?: boolean;
}) {
  const cartCount = useCart((s) => s.items.reduce((a, b) => a + b.qty, 0));

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur safe-top">
      {back && (
        <Link to={back} className="-ml-1 rounded-full p-2 hover:bg-accent">
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className="flex-1 text-base font-semibold tracking-tight">{title}</h1>
      {right ?? (
        <div className="flex items-center gap-1">
          {!hideCart && cartCount > 0 && (
            <Link to="/app/cart" className="relative rounded-full p-2 hover:bg-accent transition-colors">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            </Link>
          )}
          <NotificationBell />
        </div>
      )}
    </header>
  );
}
