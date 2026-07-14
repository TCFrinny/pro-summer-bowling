ALTER TABLE public.rostered_bowlers ALTER COLUMN entry_average TYPE numeric(6,3) USING entry_average::numeric;
ALTER TABLE public.substitutes ALTER COLUMN starting_average TYPE numeric(6,3) USING starting_average::numeric;
ALTER TABLE public.rostered_bowlers ADD CONSTRAINT rostered_bowlers_entry_average_range CHECK (entry_average >= 0 AND entry_average <= 300);
ALTER TABLE public.substitutes ADD CONSTRAINT substitutes_starting_average_range CHECK (starting_average IS NULL OR (starting_average >= 0 AND starting_average <= 300));