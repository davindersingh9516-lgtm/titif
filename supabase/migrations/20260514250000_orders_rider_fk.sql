-- orders.rider_id had no FK → PostgREST couldn't resolve the riders join
-- on the tracking page (PGRST200 "relationship not found").

ALTER TABLE public.orders
  ADD CONSTRAINT orders_rider_id_fkey
  FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE SET NULL;
