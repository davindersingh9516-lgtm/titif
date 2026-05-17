-- Ensure notification RPCs are callable by authenticated users.
-- These functions had no explicit grant so some Supabase setups block them.

GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.unread_notifications_count()    TO authenticated;
