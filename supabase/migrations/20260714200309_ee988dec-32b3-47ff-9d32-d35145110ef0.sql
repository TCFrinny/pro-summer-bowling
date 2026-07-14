-- Restore Week 1 published=true (user previously published and confirmed
-- public visibility). Do not touch date, completed, or any other data.
UPDATE public.weeks
   SET published = true
 WHERE week_number = 1
   AND published = false
   AND date IS NOT NULL;

-- Sync the cached public snapshot so public pages see the restored week
-- without waiting for the next admin mutation. Only the weeks[].published
-- field is modified.
UPDATE public.public_snapshots ps
   SET snapshot = jsonb_set(
     ps.snapshot,
     '{weeks}',
     (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'week')::int = 1
           THEN jsonb_set(elem, '{published}', 'true'::jsonb, false)
           ELSE elem
         END
         ORDER BY (elem->>'week')::int
       )
       FROM jsonb_array_elements(ps.snapshot->'weeks') elem
     )
   );