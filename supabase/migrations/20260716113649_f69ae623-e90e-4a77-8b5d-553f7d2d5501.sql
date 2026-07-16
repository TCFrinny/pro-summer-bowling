CREATE TABLE public.live_match_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_slot_id UUID NOT NULL UNIQUE
    REFERENCES public.schedule_slots(id) ON DELETE CASCADE,
  week_id UUID NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  side_a JSONB NOT NULL,
  side_b JSONB NOT NULL,
  a_game1 SMALLINT CHECK (a_game1 IS NULL OR (a_game1 BETWEEN 0 AND 300)),
  a_game2 SMALLINT CHECK (a_game2 IS NULL OR (a_game2 BETWEEN 0 AND 300)),
  a_game3 SMALLINT CHECK (a_game3 IS NULL OR (a_game3 BETWEEN 0 AND 300)),
  b_game1 SMALLINT CHECK (b_game1 IS NULL OR (b_game1 BETWEEN 0 AND 300)),
  b_game2 SMALLINT CHECK (b_game2 IS NULL OR (b_game2 BETWEEN 0 AND 300)),
  b_game3 SMALLINT CHECK (b_game3 IS NULL OR (b_game3 BETWEEN 0 AND 300)),
  entered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX live_match_results_week_id_idx ON public.live_match_results(week_id);
CREATE INDEX live_match_results_season_id_idx ON public.live_match_results(season_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_match_results TO authenticated;
GRANT ALL ON public.live_match_results TO service_role;

ALTER TABLE public.live_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view live match results"
  ON public.live_match_results
  FOR SELECT TO authenticated
  USING (public.current_user_is_admin());

CREATE POLICY "Admins can insert live match results"
  ON public.live_match_results
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin());

CREATE POLICY "Admins can update live match results"
  ON public.live_match_results
  FOR UPDATE TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

CREATE POLICY "Admins can delete live match results"
  ON public.live_match_results
  FOR DELETE TO authenticated
  USING (public.current_user_is_admin());

CREATE TRIGGER live_match_results_set_updated_at
  BEFORE UPDATE ON public.live_match_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();