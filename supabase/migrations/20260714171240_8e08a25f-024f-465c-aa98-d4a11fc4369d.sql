
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false);
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

ALTER TABLE public.match_results ALTER COLUMN linescore_a DROP NOT NULL;
ALTER TABLE public.match_results ALTER COLUMN linescore_b DROP NOT NULL;
