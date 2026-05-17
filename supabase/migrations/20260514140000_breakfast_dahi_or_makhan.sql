-- Breakfast: dahi OR makhan — not both.
-- Odd days (Sun/Tue/Thu/Sat): Amul Butter (makhan)
-- Even days (Mon/Wed/Fri): Dahi
-- Both always come with 2 paraunthe + achaar.

UPDATE public.weekly_thali SET
  thali_name = 'Itwaar Nashta',
  description = 'Aloo paraunthe — Sunday ki meethi subah',
  items = ARRAY['Aloo Paraunthe × 2', 'Amul Butter', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 0 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Somvaar Nashta',
  description = 'Aloo paraunthe — dahi ke saath',
  items = ARRAY['Aloo Paraunthe × 2', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 1 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Mangal Nashta',
  description = 'Methi paraunthe — makhan ke saath',
  items = ARRAY['Methi Paraunthe × 2', 'Amul Butter', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 2 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Budh Nashta',
  description = 'Gobhi paraunthe — dahi ke saath',
  items = ARRAY['Gobhi Paraunthe × 2', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 3 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Guru Nashta',
  description = 'Aloo paraunthe — makhan ke saath',
  items = ARRAY['Aloo Paraunthe × 2', 'Amul Butter', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 4 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Shukr Nashta',
  description = 'Pyaaz paraunthe — dahi ke saath',
  items = ARRAY['Pyaaz Paraunthe × 2', 'Dahi', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 5 AND meal_type = 'breakfast';

UPDATE public.weekly_thali SET
  thali_name = 'Shani Nashta',
  description = 'Pyaaz paraunthe — makhan ke saath',
  items = ARRAY['Pyaaz Paraunthe × 2', 'Amul Butter', 'Achaar'],
  price_mini = 70, price_large = 70
WHERE day_of_week = 6 AND meal_type = 'breakfast';
