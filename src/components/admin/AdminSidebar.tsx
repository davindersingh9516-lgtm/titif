import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, ScrollText, UtensilsCrossed, Bike, Users, Settings,
  ShieldCheck, Sparkles, ChefHat, LifeBuoy, Wallet, BarChart3, TrendingUp, IndianRupee, Repeat2, ArrowLeftRight,
} from "lucide-react";

const NAV = [
  { to: "/admin",           label: "Dashboard",  icon: LayoutDashboard, exact: true },
  { to: "/admin/overview",  label: "Overview",   icon: TrendingUp },
  { to: "/admin/analytics", label: "Analytics",  icon: BarChart3 },
  { to: "/admin/orders",    label: "Orders",     icon: ScrollText },
  { to: "/admin/kitchen",   label: "Kitchen",    icon: ChefHat },
  { to: "/admin/menu",      label: "Menu",       icon: UtensilsCrossed },
  { to: "/admin/riders",    label: "Riders",     icon: Bike },
  { to: "/admin/customers", label: "Customers",  icon: Users },
  { to: "/admin/payments",      label: "Payments",      icon: Wallet },
  { to: "/admin/transactions",  label: "Transactions",  icon: ArrowLeftRight },
  { to: "/admin/subscriptions", label: "Subscriptions", icon: Repeat2 },
  { to: "/admin/finance",       label: "Finance & Tax", icon: IndianRupee },
  { to: "/admin/support",   label: "Support",    icon: LifeBuoy },
  { to: "/admin/growth",    label: "Growth",     icon: Sparkles },
  { to: "/admin/team",      label: "Team",       icon: ShieldCheck },
  { to: "/admin/settings",  label: "Settings",   icon: Settings },
];

export function AdminSidebar() {
  const { pathname } = useLocation();

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname.startsWith(to);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
      <div className="border-b border-sidebar-border/50 px-5 py-5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Admin</div>
        <div className="mt-0.5 text-xl font-bold">Tiffin 🍱</div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {NAV.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive(to, exact)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" /> {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
