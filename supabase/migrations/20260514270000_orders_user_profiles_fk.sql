-- orders.user_id references auth.users(id) but not public.profiles(id).
-- PostgREST can't resolve "profiles:user_id(...)" join without a direct FK.
-- Adding this FK lets the admin orders page join customer name/phone inline.
-- Safe: every auth user who can place an order has a profile (created by trigger on signup).

ALTER TABLE public.orders
  ADD CONSTRAINT orders_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
