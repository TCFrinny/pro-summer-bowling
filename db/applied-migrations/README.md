# Applied migrations (historical record)

SQL files in this directory have already been applied manually to the
connected Supabase project. They are kept in the repo as an audit trail
and for regression tests that assert on their contents.

**Do not rerun these files automatically.** They are intentionally stored
outside `supabase/migrations/` so the migration tool does not pick them
up. Reapplying them against a database where they have already run may
error on existing objects or, worse, silently change state.

| File | Applied on | Target |
| --- | --- | --- |
| `20260717_100000_historical_data_phase.sql` | 2026-07-16 | connected Supabase project (Phase D historical data) |
