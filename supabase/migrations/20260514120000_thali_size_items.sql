-- Add per-size item lists to weekly_thali
-- Breakfast uses items[] (shared), price_mini = price_large = 70, no size concept
-- Lunch/Dinner use items_mini[] and items_large[] with quantities

ALTER TABLE public.weekly_thali
  ADD COLUMN IF NOT EXISTS items_mini  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS items_large text[] NOT NULL DEFAULT '{}';

-- ─── BREAKFAST: fixed ₹70, 2 paraunthe + Amul Butter/Dahi + Achaar ───────────

UPDATE public.weekly_thali SET
  thali_name = 'Itwaar Nashta', description = 'Aloo paraunthe ka Sunday subah',
  items = ARRAY['Aloo Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 0 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Somvaar Nashta', description = 'Desi morning with aloo paratha',
  items = ARRAY['Aloo Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 1 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Mangal Nashta', description = 'Methi ki khushboo, fresh start',
  items = ARRAY['Methi Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 2 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Budh Nashta', description = 'Gobhi paratha — dil khush kar de',
  items = ARRAY['Gobhi Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 3 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Guru Nashta', description = 'Classic aloo paratha, fresh start',
  items = ARRAY['Aloo Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 4 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Shukr Nashta', description = 'Pyaaz paratha — Friday vibes',
  items = ARRAY['Pyaaz Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 5 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Shani Nashta', description = 'Pyaaz paratha — chhutti ki shuruaat',
  items = ARRAY['Pyaaz Paraunthe × 2', 'Amul Butter', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70, items_mini = '{}', items_large = '{}'
WHERE day_of_week = 6 AND meal_type = 'breakfast';

-- ─── SUNDAY ──────────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Itwaar Special Thali', description = 'Hafte ka sabse khaas khana',
  items       = ARRAY['Dal Makhani', 'Shahi Paneer', 'Roti', 'Chawal', 'Raita', 'Gulab Jamun'],
  items_mini  = ARRAY['2 Roti', 'Dal Makhani 250ml', 'Aloo Sabji 200g', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Dal Makhani 400ml', 'Shahi Paneer 250g', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad', 'Gulab Jamun 2pcs', 'Chaas 250ml'],
  price_mini = 80, price_large = 130
WHERE day_of_week = 0 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Itwaar Raat Thali', description = 'Aram ki raat, garam khana',
  items       = ARRAY['Paneer Makhani', 'Dal Tadka', 'Naan', 'Chawal', 'Raita'],
  items_mini  = ARRAY['2 Roti', 'Paneer Makhani 200g', 'Dal Tadka 250ml', 'Chawal 150g', 'Salad', 'Achaar'],
  items_large = ARRAY['4 Roti', 'Paneer Makhani 300g', 'Dal Tadka 400ml', 'Naan 1pc', 'Chawal 200g', 'Raita 150ml', 'Salad', 'Kheer 150ml'],
  price_mini = 75, price_large = 120
WHERE day_of_week = 0 AND meal_type = 'dinner';

-- ─── MONDAY ──────────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Somvaar Thali', description = 'Sada aur swadisht Punjab ka khana',
  items       = ARRAY['Dal Tadka', 'Aloo Gobhi', 'Roti', 'Chawal', 'Salad', 'Papad'],
  items_mini  = ARRAY['2 Roti', 'Dal Tadka 250ml', 'Aloo Gobhi 200g', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Dal Tadka 400ml', 'Aloo Gobhi 200g', 'Mix Sabji 150g', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad', 'Gur'],
  price_mini = 75, price_large = 120
WHERE day_of_week = 1 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Somvaar Raat Thali', description = 'Rajma chawal — Punjabi soul food',
  items       = ARRAY['Rajma Masala', 'Chawal', 'Roti', 'Papad', 'Achaar'],
  items_mini  = ARRAY['2 Roti', 'Rajma Masala 250ml', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Rajma Masala 400ml', 'Aloo Sabji 150g', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad', 'Chaas 200ml'],
  price_mini = 75, price_large = 120
WHERE day_of_week = 1 AND meal_type = 'dinner';

-- ─── TUESDAY ─────────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Mangal Thali', description = 'Chole ka jaadu, puri ka swad',
  items       = ARRAY['Chole Masala', 'Dal', 'Puri', 'Chawal', 'Salad', 'Lassi'],
  items_mini  = ARRAY['2 Roti', 'Chole Masala 250ml', 'Dal 200ml', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['3 Roti', 'Chole Masala 400ml', 'Dal 300ml', 'Puri × 2', 'Chawal 200g', 'Lassi 250ml', 'Salad', 'Papad'],
  price_mini = 80, price_large = 125
WHERE day_of_week = 2 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Mangal Raat Thali', description = 'Kadhi chawal — ghar jaisi feeling',
  items       = ARRAY['Kadhi Pakora', 'Chawal', 'Roti', 'Papad', 'Achaar'],
  items_mini  = ARRAY['2 Roti', 'Kadhi 250ml', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Kadhi Pakora 400ml', 'Aloo Sabji 150g', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad', 'Chaas 200ml'],
  price_mini = 75, price_large = 115
WHERE day_of_week = 2 AND meal_type = 'dinner';

-- ─── WEDNESDAY ───────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Budh Special Thali', description = 'Sarson da saag — Punjab ki pehchaan',
  items       = ARRAY['Sarson da Saag', 'Makki di Roti', 'Makhan', 'Lassi', 'Gur'],
  items_mini  = ARRAY['Makki di Roti × 2', 'Sarson da Saag 250g', 'Makhan 1tsp', 'Chawal 100g', 'Salad', 'Achaar'],
  items_large = ARRAY['Makki di Roti × 3', 'Sarson da Saag 400g', 'Makhan 2tsp', 'Gur', 'Lassi 250ml', 'Salad', 'Achaar'],
  price_mini = 80, price_large = 125
WHERE day_of_week = 3 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Budh Raat Thali', description = 'Palak wali daal — healthy aur tasty',
  items       = ARRAY['Aloo Palak', 'Dal Tadka', 'Roti', 'Chawal', 'Salad'],
  items_mini  = ARRAY['2 Roti', 'Aloo Palak 200g', 'Dal Tadka 250ml', 'Chawal 150g', 'Salad', 'Achaar'],
  items_large = ARRAY['4 Roti', 'Aloo Palak 250g', 'Dal Tadka 400ml', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad'],
  price_mini = 75, price_large = 115
WHERE day_of_week = 3 AND meal_type = 'dinner';

-- ─── THURSDAY ────────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Guru Thali', description = 'Mix sabji — ghar ke haath ka swad',
  items       = ARRAY['Mix Veg Sabji', 'Matar Paneer', 'Dal', 'Roti', 'Chawal', 'Papad'],
  items_mini  = ARRAY['2 Roti', 'Mix Veg Sabji 200g', 'Dal 250ml', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Mix Veg Sabji 250g', 'Matar Paneer 200g', 'Dal 300ml', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad', 'Kheer 150ml'],
  price_mini = 80, price_large = 130
WHERE day_of_week = 4 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Guru Raat Thali', description = 'Paneer bhurji — protein packed raat',
  items       = ARRAY['Paneer Bhurji', 'Dal Makhani', 'Roti', 'Chawal', 'Raita'],
  items_mini  = ARRAY['2 Roti', 'Paneer Bhurji 200g', 'Dal Makhani 250ml', 'Chawal 150g', 'Salad', 'Achaar'],
  items_large = ARRAY['4 Roti', 'Paneer Bhurji 250g', 'Dal Makhani 400ml', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad'],
  price_mini = 80, price_large = 125
WHERE day_of_week = 4 AND meal_type = 'dinner';

-- ─── FRIDAY ──────────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Shukr Special Thali', description = 'Dal makhani + palak paneer — weekend ka swagat',
  items       = ARRAY['Dal Makhani', 'Palak Paneer', 'Roti', 'Chawal', 'Raita', 'Papad'],
  items_mini  = ARRAY['2 Roti', 'Dal Makhani 250ml', 'Aloo Sabji 200g', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Dal Makhani 400ml', 'Palak Paneer 250g', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad', 'Gulab Jamun 2pcs', 'Chaas 200ml'],
  price_mini = 80, price_large = 130
WHERE day_of_week = 5 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Shukr Raat Thali', description = 'Mushroom matar — fusion Punjabi',
  items       = ARRAY['Matar Mushroom', 'Dal Tadka', 'Roti', 'Chawal', 'Achaar'],
  items_mini  = ARRAY['2 Roti', 'Matar Mushroom 200g', 'Dal Tadka 250ml', 'Chawal 150g', 'Salad', 'Achaar'],
  items_large = ARRAY['4 Roti', 'Matar Mushroom 250g', 'Dal Tadka 400ml', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Papad'],
  price_mini = 75, price_large = 120
WHERE day_of_week = 5 AND meal_type = 'dinner';

-- ─── SATURDAY ────────────────────────────────────────────────────────────────

UPDATE public.weekly_thali SET
  thali_name = 'Shani Thali', description = 'Rajma + jeera rice — Punjabi classic',
  items       = ARRAY['Rajma Masala', 'Aloo Jeera', 'Roti', 'Chawal', 'Lassi', 'Papad'],
  items_mini  = ARRAY['2 Roti', 'Rajma Masala 250ml', 'Aloo Jeera 200g', 'Chawal 150g', 'Salad', 'Achaar', 'Papad'],
  items_large = ARRAY['4 Roti', 'Rajma Masala 400ml', 'Aloo Jeera 250g', 'Chawal 250g', 'Lassi 250ml', 'Salad', 'Papad'],
  price_mini = 80, price_large = 125
WHERE day_of_week = 6 AND meal_type = 'lunch';

UPDATE public.weekly_thali SET
  thali_name = 'Shani Raat Thali', description = 'Chana + kheer — meethi raat',
  items       = ARRAY['Chana Masala', 'Baingan Bharta', 'Roti', 'Chawal', 'Kheer'],
  items_mini  = ARRAY['2 Roti', 'Chana Masala 250ml', 'Baingan Bharta 150g', 'Chawal 150g', 'Salad', 'Achaar'],
  items_large = ARRAY['4 Roti', 'Chana Masala 400ml', 'Baingan Bharta 200g', 'Chawal 250g', 'Raita 150ml', 'Salad', 'Kheer 150ml'],
  price_mini = 75, price_large = 120
WHERE day_of_week = 6 AND meal_type = 'dinner';
