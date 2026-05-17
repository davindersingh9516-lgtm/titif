-- Deploy notify_user and its dependencies.
-- notify_channel enum, notification_log table, notify_user function.
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE).

-- 1. Enum (safe to re-run)
DO $$ BEGIN
  CREATE TYPE public.notify_channel AS ENUM ('whatsapp','sms','push','in_app');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. notification_log table
CREATE TABLE IF NOT EXISTS public.notification_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid,
  channel      public.notify_channel NOT NULL,
  template     text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'queued',
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- queue columns (safe if already present)
ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS priority       smallint    NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS scheduled_for  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempts       int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts   int         NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS to_phone       text;

CREATE INDEX IF NOT EXISTS idx_notif_log_user    ON public.notification_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_log_status  ON public.notification_log (status, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_log_dispatch ON public.notification_log (status, scheduled_for)
  WHERE status IN ('queued','retry');

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_log self read"    ON public.notification_log;
DROP POLICY IF EXISTS "notif_log admin manage" ON public.notification_log;
CREATE POLICY "notif_log self read"    ON public.notification_log FOR SELECT
  USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY "notif_log admin manage" ON public.notification_log FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- 3. notification_preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id               uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  in_app                boolean NOT NULL DEFAULT true,
  whatsapp              boolean NOT NULL DEFAULT true,
  low_balance_threshold numeric NOT NULL DEFAULT 100,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prefs self all" ON public.notification_preferences;
CREATE POLICY "prefs self all" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. notify_user function
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id  uuid,
  p_type     text,
  p_title    text,
  p_body     text      DEFAULT NULL,
  p_link     text      DEFAULT NULL,
  p_payload  jsonb     DEFAULT '{}'::jsonb,
  p_channels text[]    DEFAULT ARRAY['in_app','whatsapp'],
  p_priority smallint  DEFAULT 5
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pref  public.notification_preferences%rowtype;
  v_phone text;
  v_id    uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_pref FROM public.notification_preferences WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.notification_preferences(user_id) VALUES (p_user_id)
    RETURNING * INTO v_pref;
  END IF;

  IF 'in_app' = ANY(p_channels) AND v_pref.in_app THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, payload)
    VALUES (p_user_id, p_type, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb))
    RETURNING id INTO v_id;
  END IF;

  IF 'whatsapp' = ANY(p_channels) AND v_pref.whatsapp THEN
    SELECT phone INTO v_phone FROM public.profiles WHERE id = p_user_id;
    INSERT INTO public.notification_log(
      user_id, channel, template, payload, status, priority, to_phone
    ) VALUES (
      p_user_id, 'whatsapp', p_type,
      coalesce(p_payload, '{}'::jsonb)
        || jsonb_build_object('title', p_title, 'body', p_body, 'link', p_link),
      'queued', p_priority, v_phone
    );
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.notify_user(uuid,text,text,text,text,jsonb,text[],smallint) TO authenticated;
