import { Link, useLocation } from "@tanstack/react-router";
import { Home, UtensilsCrossed, Wallet, ScrollText, User, ShoppingCart, Repeat2 } from "lucide-react";
import { useCart } from "@/lib/cart";

const NAV = [
  { to: "/app",               label: "Home",      icon: Home },
  { to: "/app/menu",          label: "Menu",      icon: UtensilsCrossed },
  { to: "/app/cart",          label: "Cart",      icon: ShoppingCart, cart: true },
  { to: "/app/subscriptions", label: "Subscribe", icon: Repeat2 },
  { to: "/app/wallet",        label: "Wallet",    icon: Wallet },
  { to: "/app/orders",        label: "Orders",    icon: ScrollText },
  { to: "/app/profile",       label: "Profile",   icon: User },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  const cartCount = useCart((s) => s.items.reduce((a, b) => a + b.qty, 0));

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur safe-bottom"
      style={{ maxWidth: 480, marginInline: "auto" }}
    >
      <ul className="grid grid-cols-7 px-1 pt-1">
        {NAV.map(({ to, label, icon: Icon, ...rest }) => {
          const isCart = (rest as any).cart === true;
          const active = to === "/app" ? pathname === "/app" : pathname.startsWith(to);
          return (
            <li key={to}>
              <Link
                to={to}
                className={`group relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium tap transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute -top-px h-0.5 w-6 rounded-full bg-primary transition-all duration-300 ${
                    active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-50"
                  }`}
                />
                <span className="relative">
                  <Icon
                    className={`h-5 w-5 transition-transform duration-200 ${
                      active ? "stroke-[2.4] scale-110" : "group-active:scale-95"
                    } ${isCart && cartCount > 0 ? "stroke-primary" : ""}`}
                  />
                  {isCart && cartCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                      {cartCount > 9 ? "9+" : cartCount}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
