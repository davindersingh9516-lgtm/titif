
CREATE TABLE IF NOT EXISTS public.daily_menu_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  meal_type meal_type NOT NULL,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (date, meal_type, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_menu_plan_lookup
  ON public.daily_menu_plan (date, meal_type);

ALTER TABLE public.daily_menu_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily plan read auth"
  ON public.daily_menu_plan FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "daily plan admin manage"
  ON public.daily_menu_plan FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.menu_for_day(p_date date, p_meal meal_type)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  size meal_size,
  price numeric,
  image_url text,
  meal_type meal_type,
  sort_order int,
  is_planned boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH planned AS (
    SELECT mi.id, mi.name, mi.description, mi.size, mi.price, mi.image_url, mi.meal_type,
           dmp.sort_order, true AS is_planned
    FROM public.daily_menu_plan dmp
    JOIN public.menu_items mi ON mi.id = dmp.menu_item_id
    WHERE dmp.date = p_date AND dmp.meal_type = p_meal AND mi.active = true
  ),
  has_plan AS (
    SELECT EXISTS (SELECT 1 FROM public.daily_menu_plan WHERE date = p_date AND meal_type = p_meal) AS yes
  )
  SELECT * FROM planned
  UNION ALL
  SELECT mi.id, mi.name, mi.description, mi.size, mi.price, mi.image_url, mi.meal_type,
         0 AS sort_order, false AS is_planned
  FROM public.menu_items mi, has_plan
  WHERE mi.meal_type = p_meal AND mi.active = true AND has_plan.yes = false
  ORDER BY sort_order, price;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_daily_plan(
  p_date date, p_meal meal_type, p_items jsonb
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; v_item jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.daily_menu_plan WHERE date = p_date AND meal_type = p_meal;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RETURN 0; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.daily_menu_plan(date, meal_type, menu_item_id, sort_order, created_by)
    VALUES (p_date, p_meal, (v_item->>'menu_item_id')::uuid,
            COALESCE((v_item->>'sort_order')::int, 0), auth.uid());
    v_count := v_count + 1;
  END LOOP;
  INSERT INTO public.audit_log(actor_id, action, target, meta)
  VALUES (auth.uid(), 'daily_plan.set', p_date::text || '/' || p_meal::text,
          jsonb_build_object('count', v_count));
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.admin_copy_plan(
  p_from date, p_to date, p_meal meal_type DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.daily_menu_plan
  WHERE date = p_to AND (p_meal IS NULL OR meal_type = p_meal);
  INSERT INTO public.daily_menu_plan(date, meal_type, menu_item_id, sort_order, created_by)
  SELECT p_to, meal_type, menu_item_id, sort_order, auth.uid()
  FROM public.daily_menu_plan
  WHERE date = p_from AND (p_meal IS NULL OR meal_type = p_meal);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
