CREATE OR REPLACE FUNCTION public.substitute_referenced(_sub_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admin-only: the helper elevates past RLS to scan match_results JSON,
  -- so anonymous or non-admin callers must be refused inside the body.
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.match_results r
    WHERE
         jsonb_path_exists(r.side_a, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id))
      OR jsonb_path_exists(r.side_b, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id))
      OR (r.linescore_a IS NOT NULL AND jsonb_path_exists(r.linescore_a, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id)))
      OR (r.linescore_b IS NOT NULL AND jsonb_path_exists(r.linescore_b, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id)))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.substitute_referenced(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.substitute_referenced(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.substitute_referenced(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.substitute_referenced(text) TO service_role;