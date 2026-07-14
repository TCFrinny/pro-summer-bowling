
-- Remove public/anon EXECUTE on internal security-definer helpers.
-- has_role & week_published stay callable by RLS internals (definer runs as owner),
-- but no external caller should be able to hit them via PostgREST.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.week_published(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;

-- Trigger functions don't need SECURITY DEFINER at all.
alter function public.tg_set_updated_at() security invoker;
