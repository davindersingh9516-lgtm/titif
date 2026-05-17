-- app_settings write policy was restricted to super_admin only.
-- super_admin role has been merged into admin — fix the policy to use is_admin().

DROP POLICY IF EXISTS "settings super manage" ON public.app_settings;

CREATE POLICY "settings admin manage" ON public.app_settings
  FOR ALL
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
