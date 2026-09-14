-- VIGIL AI — demo seed for the live (Supabase) environment.
-- Creates the same demo accounts as server/seed_data.py for parity.
-- Passwords for auth.users must be set via the Supabase dashboard or admin API;
-- this script provisions profiles, units and membership.

-- 1) Create auth users (adjust emails/ids as needed)
-- Do this via dashboard: admin@vigil.demo, supervisor@vigil.demo, medic@vigil.demo,
-- priya@vigil.demo, rohan@vigil.demo, leila@vigil.demo — all with the demo password
-- for local/live demo environments only.

-- 2) Profiles (auth_user_id must reference the created auth users)
insert into units (id, name, description)
values ('11111111-1111-1111-1111-111111111111', 'Alpha Unit', 'Operations support unit — demo organisation.')
on conflict (name) do nothing;

-- Example (after auth users exist):
-- insert into profiles (auth_user_id, email, full_name, role, unit_id, avatar_color)
-- select id, email, 'Arun Mehta', 'admin', null, 'violet' from auth.users where email = 'admin@vigil.demo';
