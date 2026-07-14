
GRANT EXECUTE ON FUNCTION public.week_published(uuid) TO authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seasons          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rostered_bowlers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.substitutes      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weeks            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_slots   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_results    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_snapshots TO authenticated;
GRANT SELECT ON public.seasons, public.rostered_bowlers, public.substitutes,
               public.weeks, public.schedule_slots, public.match_results,
               public.public_snapshots TO anon;

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated, anon;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

DROP POLICY IF EXISTS "Admins manage seasons"          ON public.seasons;
DROP POLICY IF EXISTS "Admins manage rostered bowlers" ON public.rostered_bowlers;
DROP POLICY IF EXISTS "Admins manage substitutes"      ON public.substitutes;
DROP POLICY IF EXISTS "Admins manage weeks"            ON public.weeks;
DROP POLICY IF EXISTS "Admins manage slots"            ON public.schedule_slots;
DROP POLICY IF EXISTS "Admins manage results"          ON public.match_results;
DROP POLICY IF EXISTS "Admins manage snapshot"         ON public.public_snapshots;
DROP POLICY IF EXISTS "Admins manage roles"            ON public.user_roles;
DROP POLICY IF EXISTS "Admins read all profiles"       ON public.profiles;
DROP POLICY IF EXISTS "Authed reads weeks"             ON public.weeks;
DROP POLICY IF EXISTS "Authed reads slots"             ON public.schedule_slots;
DROP POLICY IF EXISTS "Authed reads results"           ON public.match_results;

CREATE POLICY "Admins manage seasons"          ON public.seasons          FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage rostered bowlers" ON public.rostered_bowlers FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage substitutes"      ON public.substitutes      FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage weeks"            ON public.weeks            FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage slots"            ON public.schedule_slots   FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage results"          ON public.match_results    FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage snapshot"         ON public.public_snapshots FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins manage roles"            ON public.user_roles       FOR ALL TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
CREATE POLICY "Admins read all profiles"       ON public.profiles         FOR SELECT TO authenticated USING (public.current_user_is_admin());
CREATE POLICY "Authed reads weeks"             ON public.weeks            FOR SELECT TO authenticated USING (published = true OR public.current_user_is_admin());
CREATE POLICY "Authed reads slots"             ON public.schedule_slots   FOR SELECT TO authenticated USING (public.week_published(week_id) OR public.current_user_is_admin());
CREATE POLICY "Authed reads results"           ON public.match_results    FOR SELECT TO authenticated USING (public.week_published(week_id) OR public.current_user_is_admin());

INSERT INTO public.seasons (label, is_current)
SELECT '2026 Summer', true
WHERE NOT EXISTS (SELECT 1 FROM public.seasons WHERE label = '2026 Summer');

UPDATE public.seasons SET is_current = (label = '2026 Summer');
