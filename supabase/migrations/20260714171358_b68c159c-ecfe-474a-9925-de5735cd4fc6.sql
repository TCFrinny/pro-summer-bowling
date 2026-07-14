REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;