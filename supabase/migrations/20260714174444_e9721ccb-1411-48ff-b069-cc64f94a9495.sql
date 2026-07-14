-- 1) Safe, admin-usable helper to detect substitute references anywhere in
--    match_results JSON (side_a, side_b, linescore_a, linescore_b). Uses
--    parameterized jsonpath variables so the sub id is never string-interpolated.
CREATE OR REPLACE FUNCTION public.substitute_referenced(_sub_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_results r
    WHERE
         jsonb_path_exists(r.side_a, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id))
      OR jsonb_path_exists(r.side_b, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id))
      OR (r.linescore_a IS NOT NULL AND jsonb_path_exists(r.linescore_a, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id)))
      OR (r.linescore_b IS NOT NULL AND jsonb_path_exists(r.linescore_b, '$.** ? (@ == $sub)', jsonb_build_object('sub', _sub_id)))
  );
$$;
REVOKE ALL   ON FUNCTION public.substitute_referenced(text) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.substitute_referenced(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.substitute_referenced(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.substitute_referenced(text) TO service_role;

-- 2) Partial CHECK constraints: only ACTIVE + non-archived rows must carry a
--    valid ID Number (1..10 non-blank chars). Inactive or archived legacy
--    rows may still hold NULL/blank so admins can repair them. The server
--    code sets `active=false` on restore, so restore never re-triggers this.
ALTER TABLE public.rostered_bowlers
  DROP CONSTRAINT IF EXISTS rostered_active_bowler_number_valid;
ALTER TABLE public.rostered_bowlers
  ADD  CONSTRAINT rostered_active_bowler_number_valid
  CHECK (
    archived
    OR NOT active
    OR (
      bowler_number IS NOT NULL
      AND btrim(bowler_number) <> ''
      AND char_length(btrim(bowler_number)) <= 10
    )
  );

ALTER TABLE public.substitutes
  DROP CONSTRAINT IF EXISTS substitutes_active_bowler_number_valid;
ALTER TABLE public.substitutes
  ADD  CONSTRAINT substitutes_active_bowler_number_valid
  CHECK (
    archived
    OR NOT active
    OR (
      bowler_number IS NOT NULL
      AND btrim(bowler_number) <> ''
      AND char_length(btrim(bowler_number)) <= 10
    )
  );