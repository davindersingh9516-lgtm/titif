import { createFileRoute, Link } from "@tanstack/react-router";
import { useOrders } from "@/hooks/use-orders";
import { AppHeader } from "@/components/customer/AppHeader";
import { fmtINR, MEAL_LABEL, WINDOW_LABEL, type MealType } from "@/lib/meals";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/app/orders")({
  component: OrdersPage,
});

const STATUS_STYLE: Record<string, string> = {
  placed: "bg-warning/15 text-warning-foreground",
  preparing: "bg-warning/15 text-warning-foreground",
  out_for_delivery: "bg-primary/15 text-primary",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

function OrdersPage() {
  const { data: orders } = useOrders();

  return (
    <div>
      <AppHeader title="Your orders" back="/app" />
      <div className="space-y-3 px-4 py-4">
        {orders?.length === 0 && (
          <div className="py-16 text-center text-muted-foreground">No orders yet</div>
        )}
        {orders?.map((o: any) => (
          <Link
            key={o.id}
            to="/app/track/$id"
            params={{ id: o.id }}
            className="block rounded-2xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold">{MEAL_LABEL[o.meal_type as MealType]}</div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[o.status]}`}>
                {String(o.status).replace("_", " ")}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {new Date(o.delivery_date + "T00:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} ·{" "}
              {WINDOW_LABEL[o.meal_type as MealType][o.delivery_window as "round_1" | "round_2"]}
            </div>
            <div className="mt-2 truncate text-xs text-muted-foreground">
              {o.order_items?.map((i: any) => `${i.qty}× ${i.name}`).join(", ")}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-sm font-bold">{fmtINR(Number(o.total))}</div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
