-- Kitchen prep summary: orders by meal_type × size for today (IST)
-- Admin uses this to know exactly how many of each thali to prepare.

CREATE OR REPLACE FUNCTION public.today_meal_summary()
RETURNS TABLE(meal_type meal_type, size text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    o.meal_type,
    oi.size,
    COUNT(DISTINCT o.id)::bigint AS orders
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.delivery_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND o.status NOT IN ('cancelled')
  GROUP BY o.meal_type, oi.size
  ORDER BY o.meal_type, oi.size;
$$;

REVOKE ALL ON FUNCTION public.today_meal_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.today_meal_summary() TO authenticated;
