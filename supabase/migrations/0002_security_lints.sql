-- Fixes the two warnings Supabase's security advisor raised on 0001:
-- 1. functions with a role-mutable search_path (a caller could shadow a table name)
-- 2. the vector extension installed in public instead of the extensions schema

alter function set_updated_at() set search_path = public;
alter function match_items(vector(512), float, int) set search_path = public, extensions;

-- don't touch / `vector(512)` columns keep working because Supabase's default search_path
-- includes `extensions`; app code never needs to qualify the type.
alter extension vector set schema extensions;
