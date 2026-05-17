-- Weekly recurring thali template (day_of_week 0=Sun … 6=Sat × meal_type)
-- Admin sets what thali is served each day; users order from it.

CREATE TABLE public.weekly_thali (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_type    meal_type NOT NULL,
  thali_name   text NOT NULL,
  description  text,
  items        text[] NOT NULL DEFAULT '{}',  -- e.g. {'Dal Makhani','3 Roti','Rice','Salad'}
  price_mini   numeric(10,2) NOT NULL DEFAULT 60,
  price_large  numeric(10,2) NOT NULL DEFAULT 90,
  is_available boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day_of_week, meal_type)
);

ALTER TABLE public.weekly_thali ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_thali read auth"
  ON public.weekly_thali FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "weekly_thali admin manage"
  ON public.weekly_thali FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE TRIGGER trg_weekly_thali_updated
  BEFORE UPDATE ON public.weekly_thali
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RPC: get thali for a specific day+meal (0=Sun … 6=Sat)
CREATE OR REPLACE FUNCTION public.thali_for_day(p_day smallint, p_meal meal_type)
RETURNS SETOF public.weekly_thali
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM weekly_thali WHERE day_of_week = p_day AND meal_type = p_meal;
$$;

-- RPC: get today's thali (uses IST timezone)
CREATE OR REPLACE FUNCTION public.today_thali(p_meal meal_type)
RETURNS SETOF public.weekly_thali
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM weekly_thali
  WHERE day_of_week = EXTRACT(DOW FROM now() AT TIME ZONE 'Asia/Kolkata')::smallint
    AND meal_type = p_meal
    AND is_available = true;
$$;

REVOKE ALL ON FUNCTION public.thali_for_day(smallint, meal_type) FROM public, anon;
REVOKE ALL ON FUNCTION public.today_thali(meal_type) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.thali_for_day(smallint, meal_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.today_thali(meal_type) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: 7 days × 3 meals — Punjabi veg home-style thali
-- day 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.weekly_thali (day_of_week, meal_type, thali_name, description, items, price_mini, price_large) VALUES

-- SUNDAY
(0,'breakfast','Itwaar Special Nashta','Poori-chole ka nasha, Sunday vibes',
  ARRAY['Poori × 2','Chole Masala','Dahi','Gur','Chai'],50,80),
(0,'lunch','Itwaar Special Thali','Hafte ka sabse khaas khana',
  ARRAY['Shahi Paneer','Dal Makhani','Jeera Rice','4 Roti','Raita','Gulab Jamun'],70,110),
(0,'dinner','Itwaar Raat Thali','Aram ki raat, garam khana',
  ARRAY['Paneer Makhani','Dal Tadka','Naan × 2','Chawal','Raita','Achaar'],65,100),

-- MONDAY
(1,'breakfast','Somvaar Nashta','Desi morning with aloo paratha',
  ARRAY['Aloo Paratha × 2','Makhan','Dahi','Achaar','Chai'],50,75),
(1,'lunch','Somvaar Thali','Sada aur swadisht Punjab ka khana',
  ARRAY['Dal Tadka','Aloo Gobhi','3 Roti','Chawal','Salad','Papad'],60,90),
(1,'dinner','Somvaar Raat Thali','Rajma chawal — Punjabi soul food',
  ARRAY['Rajma Masala','Chawal','2 Roti','Papad','Achaar'],60,90),

-- TUESDAY
(2,'breakfast','Mangal Nashta','Methi ka tarka, dil ki baat',
  ARRAY['Methi Paratha × 2','Dahi','Achaar','Chai'],50,75),
(2,'lunch','Mangal Thali','Chole ka jaadu, puri ka swad',
  ARRAY['Chole Masala','Puri × 3','Dal','Chawal','Salad','Lassi'],65,95),
(2,'dinner','Mangal Raat Thali','Kadhi chawal — ghar jaisi feeling',
  ARRAY['Kadhi Pakora','Chawal','3 Roti','Papad','Achaar'],60,90),

-- WEDNESDAY
(3,'breakfast','Budh Nashta','Gobhi paratha — dil khush kar de',
  ARRAY['Gobhi Paratha × 2','Dahi','Makhan','Chai','Achaar'],50,75),
(3,'lunch','Budh Special Thali','Sarson da saag — Punjab ki pehchaan',
  ARRAY['Sarson da Saag','Makki di Roti × 3','Makhan','Lassi','Gur'],65,100),
(3,'dinner','Budh Raat Thali','Palak wali daal — healthy aur tasty',
  ARRAY['Aloo Palak','Dal Tadka','3 Roti','Chawal','Salad'],60,90),

-- THURSDAY
(4,'breakfast','Guru Nashta','Poha aur chai — simple, clean start',
  ARRAY['Aloo Poha','Chai','Kela','Achaar'],45,70),
(4,'lunch','Guru Thali','Mix sabji — ghar ke haath ka swad',
  ARRAY['Mix Veg Sabji','Dal','3 Roti','Chawal','Salad','Papad'],60,90),
(4,'dinner','Guru Raat Thali','Paneer bhurji — protein packed raat',
  ARRAY['Paneer Bhurji','Dal Makhani','3 Roti','Chawal','Raita'],65,100),

-- FRIDAY
(5,'breakfast','Shukr Nashta','Classic aloo paratha combo',
  ARRAY['Aloo Paratha × 2','Dahi','Achaar','Chai'],50,75),
(5,'lunch','Shukr Special Thali','Dal makhani + palak paneer — weekend ka swagat',
  ARRAY['Dal Makhani','Palak Paneer','4 Roti','Chawal','Raita','Papad'],70,105),
(5,'dinner','Shukr Raat Thali','Mushroom matar — fusion Punjabi',
  ARRAY['Matar Mushroom','Dal Tadka','3 Roti','Chawal','Achaar'],60,95),

-- SATURDAY
(6,'breakfast','Shani Nashta','Aloo puri — chhutti ki shuruaat',
  ARRAY['Aloo Puri × 3','Dahi','Chai','Achaar'],50,80),
(6,'lunch','Shani Thali','Rajma + jeera rice — Punjabi classic',
  ARRAY['Rajma Masala','Aloo Jeera','3 Roti','Chawal','Lassi','Papad'],65,95),
(6,'dinner','Shani Raat Thali','Chana + kheer — meethi raat',
  ARRAY['Chana Masala','Baingan Bharta','3 Roti','Chawal','Kheer'],65,100)

ON CONFLICT (day_of_week, meal_type) DO NOTHING;
