import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtINR, MEAL_LABEL, toIST, type MealType } from "@/lib/meals";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Save, ChefHat } from "lucide-react";
import { useConfirm } from "@/hooks/use-confirm";

export const Route = createFileRoute("/admin/menu")({
  component: MenuAdmin,
});

type MenuItem = {
  id: string; meal_type: MealType; size: string; name: string;
  description: string | null; price: number; active: boolean; image_url: string | null;
};

type WeeklyThali = {
  id: string; day_of_week: number; meal_type: MealType; thali_name: string;
  description: string | null; items: string[]; items_mini: string[]; items_large: string[];
  price_mini: number; price_large: number; is_available: boolean; updated_at: string;
};

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_HINDI = ["Itwaar", "Somvaar", "Mangalvaar", "Budhvaar", "Guruvaar", "Shukrvaar", "Shanivaar"];

function MenuAdmin() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Menu</h1>
        <p className="text-sm text-muted-foreground">
          Weekly thali planner — set what's served each day. Users see & order it from their app.
        </p>
      </div>
      <Tabs defaultValue="planner" className="w-full">
        <TabsList>
          <TabsTrigger value="planner">Weekly Thali Planner</TabsTrigger>
          <TabsTrigger value="library">Item Library</TabsTrigger>
        </TabsList>
        <TabsContent value="planner" className="mt-4"><WeekPlanner /></TabsContent>
        <TabsContent value="library" className="mt-4"><ItemLibrary /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Weekly Thali Planner ─── */

function WeekPlanner() {
  const qc = useQueryClient();
  const [meal, setMeal] = useState<MealType>("lunch");
  const [editing, setEditing] = useState<WeeklyThali | null>(null);
  const todayDow = toIST().getUTCDay(); // IST day of week

  const { data: thalis, isLoading } = useQuery({
    queryKey: ["weekly-thali", meal],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_thali" as any)
        .select("*")
        .eq("meal_type", meal)
        .order("day_of_week");
      if (error) throw error;
      return (data ?? []) as unknown as WeeklyThali[];
    },
  });

  // Map day_of_week → thali for easy lookup
  const byDay = useMemo(() => {
    const m: Record<number, WeeklyThali> = {};
    (thalis ?? []).forEach((t) => { m[t.day_of_week] = t; });
    return m;
  }, [thalis]);

  const toggleAvailable = async (thali: WeeklyThali) => {
    const { error } = await supabase
      .from("weekly_thali" as any)
      .update({ is_available: !thali.is_available })
      .eq("id", thali.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["weekly-thali"] });
  };

  return (
    <div className="space-y-5">
      {/* Meal selector */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {MEALS.map((m) => (
          <button
            key={m}
            onClick={() => setMeal(m)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              meal === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {MEAL_LABEL[m]}
          </button>
        ))}
      </div>

      {/* 7 day cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 7 }, (_, dow) => {
          const thali = byDay[dow];
          const isToday = dow === todayDow;
          return (
            <Card
              key={dow}
              className={`p-4 flex flex-col gap-3 transition ${
                isToday ? "border-primary ring-1 ring-primary/30" : ""
              } ${thali && !thali.is_available ? "opacity-60" : ""}`}
            >
              {/* Day header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold">{DAY_FULL[dow]}</span>
                    {isToday && <Badge className="text-[10px] px-1.5 h-4">Today</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{DAY_HINDI[dow]}</div>
                </div>
                {thali && (
                  <Switch
                    checked={thali.is_available}
                    onCheckedChange={() => toggleAvailable(thali)}
                    title={thali.is_available ? "Available — click to stop" : "Stopped — click to enable"}
                  />
                )}
              </div>

              {/* Thali content */}
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : thali ? (
                <>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <ChefHat className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold text-sm">{thali.thali_name}</span>
                    </div>
                    {thali.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{thali.description}</p>
                    )}
                  </div>

                  {/* Items */}
                  <div className="flex flex-wrap gap-1">
                    {thali.items.slice(0, 5).map((item, i) => (
                      <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {item}
                      </span>
                    ))}
                    {thali.items.length > 5 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        +{thali.items.length - 5} more
                      </span>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => setEditing(thali)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                  No thali set
                  <br />
                  <span className="text-primary cursor-pointer" onClick={() => setEditing({
                    id: "", day_of_week: dow, meal_type: meal,
                    thali_name: `${DAY_FULL[dow]} ${MEAL_LABEL[meal]} Thali`,
                    description: "", items: [], items_mini: [], items_large: [],
                    price_mini: meal === "breakfast" ? 70 : 75,
                    price_large: meal === "breakfast" ? 70 : 120,
                    is_available: true, updated_at: "",
                  })}>+ Add thali</span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Edit Dialog */}
      {editing && (
        <ThaliEditDialog
          thali={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["weekly-thali"] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ThaliEditDialog({
  thali, onClose, onSaved,
}: {
  thali: WeeklyThali; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !thali.id;
  const isBreakfast = thali.meal_type === "breakfast";

  const [form, setForm] = useState({
    thali_name: thali.thali_name,
    description: thali.description ?? "",
    itemsText:      thali.items.join("\n"),
    itemsMiniText:  (thali.items_mini ?? []).join("\n"),
    itemsLargeText: (thali.items_large ?? []).join("\n"),
    is_available: thali.is_available,
  });

  const save = async () => {
    if (!form.thali_name.trim()) return toast.error("Thali name required");

    const items       = form.itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
    const items_mini  = isBreakfast ? [] : form.itemsMiniText.split("\n").map((s) => s.trim()).filter(Boolean);
    const items_large = isBreakfast ? [] : form.itemsLargeText.split("\n").map((s) => s.trim()).filter(Boolean);

    const payload = {
      day_of_week: thali.day_of_week,
      meal_type: thali.meal_type,
      thali_name: form.thali_name.trim(),
      description: form.description.trim() || null,
      items, items_mini, items_large,
      is_available: form.is_available,
    };

    const { error } = isNew
      ? await supabase.from("weekly_thali" as any).insert(payload)
      : await supabase.from("weekly_thali" as any).update(payload).eq("id", thali.id);

    if (error) return toast.error(error.message);
    toast.success(isNew ? "Thali created" : "Thali updated");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {DAY_FULL[thali.day_of_week]} · {MEAL_LABEL[thali.meal_type]} Thali
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Thali Name</Label>
            <Input
              value={form.thali_name}
              onChange={(e) => setForm({ ...form, thali_name: e.target.value })}
              placeholder="e.g. Somvaar Special Thali"
            />
          </div>
          <div>
            <Label>Tagline / Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. Ghar jaisa khana"
            />
          </div>

          {isBreakfast ? (
            /* Breakfast: single items list, single price */
            <>
              <div>
                <Label>Items <span className="text-muted-foreground font-normal">(ek line mein ek item)</span></Label>
                <Textarea
                  rows={5}
                  value={form.itemsText}
                  onChange={(e) => setForm({ ...form, itemsText: e.target.value })}
                  placeholder={"Aloo Paraunthe × 2\nAmul Butter\nDahi\nAchaar"}
                  className="font-mono text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {form.itemsText.split("\n").filter((s) => s.trim()).length} items
                </p>
              </div>
            </>
          ) : (
            /* Lunch / Dinner: separate items_mini and items_large + two prices */
            <>
              <div>
                <Label className="text-primary">Mini Thali Items <span className="text-muted-foreground font-normal">(with quantities)</span></Label>
                <Textarea
                  rows={5}
                  value={form.itemsMiniText}
                  onChange={(e) => setForm({ ...form, itemsMiniText: e.target.value })}
                  placeholder={"2 Roti\nDal Tadka 250ml\nAloo Gobhi 200g\nChawal 150g\nSalad\nAchaar\nPapad"}
                  className="font-mono text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {form.itemsMiniText.split("\n").filter((s) => s.trim()).length} items
                </p>
              </div>
              <div>
                <Label className="text-amber-600">Large Thali Items <span className="text-muted-foreground font-normal">(with quantities)</span></Label>
                <Textarea
                  rows={6}
                  value={form.itemsLargeText}
                  onChange={(e) => setForm({ ...form, itemsLargeText: e.target.value })}
                  placeholder={"4 Roti\nDal Tadka 400ml\nAloo Gobhi 200g\nMix Sabji 150g\nChawal 250g\nRaita 150ml\nSalad\nPapad\nGur"}
                  className="font-mono text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {form.itemsLargeText.split("\n").filter((s) => s.trim()).length} items
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Overview items (shown as pills in card preview)</Label>
                <Textarea
                  rows={2}
                  value={form.itemsText}
                  onChange={(e) => setForm({ ...form, itemsText: e.target.value })}
                  placeholder={"Dal Tadka\nAloo Gobhi\nRoti\nChawal"}
                  className="font-mono text-sm"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="text-sm font-medium">Available today</div>
              <div className="text-xs text-muted-foreground">Off = customers can't order this thali</div>
            </div>
            <Switch
              checked={form.is_available}
              onCheckedChange={(v) => setForm({ ...form, is_available: v })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><Save className="mr-1 h-4 w-4" /> Save thali</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Item Library (CRUD) — unchanged ─── */

function ItemLibrary() {
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const { data: items } = useQuery({
    queryKey: ["admin-menu-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("menu_items").select("*").order("meal_type").order("price");
      if (error) throw error;
      return (data ?? []) as MenuItem[];
    },
  });

  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const g: Record<MealType, MenuItem[]> = { breakfast: [], lunch: [], dinner: [] };
    (items ?? []).forEach((it) => g[it.meal_type]?.push(it));
    return g;
  }, [items]);

  const toggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("menu_items").update({ active }).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["admin-menu-items"] });
  };

  const remove = async (id: string) => {
    const ok = await confirmDialog({
      title: "Delete this item?",
      body: "This cannot be undone. The item will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["admin-menu-items"] }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Legacy item library — used as fallback when no weekly thali is set.</p>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> New item
        </Button>
      </div>
      {MEALS.map((meal) => (
        <div key={meal}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{MEAL_LABEL[meal]}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {grouped[meal].length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No items yet</div>
            )}
            {grouped[meal].map((it) => (
              <Card key={it.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{it.size}</div>
                    <div className="truncate font-semibold">{it.name}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{it.description}</div>
                    <div className="mt-2 font-bold">{fmtINR(Number(it.price))}</div>
                  </div>
                  <Switch checked={it.active} onCheckedChange={(v) => toggle(it.id, v)} />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing(it); setOpen(true); }}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(it.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      <ItemDialog open={open} onOpenChange={setOpen} item={editing} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-menu-items"] })} />
    </div>
  );
}

function ItemDialog({ open, onOpenChange, item, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; item: MenuItem | null; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: item?.name ?? "", description: item?.description ?? "",
    meal_type: (item?.meal_type ?? "lunch") as MealType,
    size: item?.size ?? "mini", price: String(item?.price ?? ""), active: item?.active ?? true,
  });

  useEffect(() => {
    if (open) setForm({
      name: item?.name ?? "", description: item?.description ?? "",
      meal_type: (item?.meal_type ?? "lunch") as MealType,
      size: item?.size ?? "mini", price: String(item?.price ?? ""), active: item?.active ?? true,
    });
  }, [item?.id, open]);

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    const price = parseFloat(form.price);
    if (isNaN(price) || price < 0) return toast.error("Invalid price");
    const payload: any = { name: form.name.trim(), description: form.description.trim() || null, meal_type: form.meal_type, size: form.size, price, active: form.active };
    const { error } = item
      ? await supabase.from("menu_items").update(payload).eq("id", item.id)
      : await supabase.from("menu_items").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(item ? "Updated" : "Created");
    onSaved(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{item ? "Edit item" : "New menu item"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Description</Label><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Meal</Label>
              <Select value={form.meal_type} onValueChange={(v) => setForm({ ...form, meal_type: v as MealType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MEALS.map((m) => <SelectItem key={m} value={m}>{MEAL_LABEL[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Size</Label>
              <Select value={form.size} onValueChange={(v) => setForm({ ...form, size: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mini">Mini</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Price (₹)</Label><Input type="number" min="0" step="1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><div className="text-sm font-medium">Active</div><div className="text-xs text-muted-foreground">Inactive items hidden from customers</div></div>
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}><Save className="mr-1 h-4 w-4" /> Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
