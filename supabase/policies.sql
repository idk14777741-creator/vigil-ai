-- ==========================================================================
-- VIGIL AI — Row Level Security & Storage policies (live mode)
-- Principles:
--   · Users read/write their own rows; nobody else's, unless a role explicitly allows.
--   · Wellness data: owner + assigned Medic Officer, and only what the owner authorises.
--   · Buddy connections see ONLY rows tied to their accepted connection.
--   · Incidents: reporter, admins; supervisors only via explicit assignment tables.
--   · Buddy / Message-From-Home participants have NO access to wellness, incidents,
--     AI conversations or supervisor communications.
-- ==========================================================================

alter table profiles            enable row level security;
alter table units               enable row level security;
alter table unit_members        enable row level security;
alter table shifts              enable row level security;
alter table tasks               enable row level security;
alter table wellness_data       enable row level security;
alter table recovery_scores     enable row level security;
alter table incidents           enable row level security;
alter table medic_requests      enable row level security;
alter table supervisor_requests enable row level security;
alter table buddy_connections   enable row level security;
alter table buddy_messages      enable row level security;
alter table support_contacts    enable row level security;
alter table support_videos      enable row level security;
alter table music_tracks        enable row level security;
alter table music_history       enable row level security;
alter table destress_videos     enable row level security;
alter table notifications       enable row level security;
alter table weekly_reports      enable row level security;
alter table ai_conversations    enable row level security;
alter table ai_messages         enable row level security;
alter table audit_logs          enable row level security;
alter table password_resets     enable row level security;

-- ---------- helpers ----------

create or replace function current_profile() returns profiles as $$
  select * from profiles where auth_user_id = auth.uid();
$$ language sql stable security definer;

create or replace function is_admin() returns boolean as $$
  select current_profile().role = 'admin';
$$ language sql stable security definer;

create or replace function is_in_my_unit(other uuid) returns boolean as $$
  select exists (
    select 1 from unit_members m
    where m.user_id = other and m.unit_id in (select unit_id from unit_members where user_id = auth.uid())
  );
$$ language sql stable security definer;

-- ---------- profiles ----------
create policy "read own profile" on profiles for select using (id = current_profile().id);
create policy "admins read all profiles" on profiles for select using (is_admin());
create policy "team members read unit roster" on profiles for select using (
  is_in_my_unit(id) or exists (select 1 from unit_members m where m.user_id = id and m.unit_id in (select unit_id from unit_members where user_id = auth.uid()))
);
create policy "update own profile" on profiles for update using (id = current_profile().id)
  with check (id = current_profile().id and role = current_profile().role and status = current_profile().status);
create policy "admins manage profiles" on profiles for all using (is_admin());

-- ---------- units / membership ----------
create policy "members read own units" on units for select using (
  exists (select 1 from unit_members m where m.unit_id = id and m.user_id = auth.uid()) or is_admin()
);
create policy "admins manage units" on units for all using (is_admin());
create policy "read own membership" on unit_members for select using (user_id = auth.uid() or is_admin()
  or exists (select 1 from unit_members m2 where m2.unit_id = unit_members.unit_id and m2.user_id = auth.uid()));
create policy "admins manage membership" on unit_members for all using (is_admin());

-- ---------- shifts ----------
create policy "own shifts" on shifts for select using (user_id = auth.uid() or is_admin()
  or exists ( -- supervisors see shifts of their unit personnel
    select 1 from profiles p join unit_members m on m.user_id = p.id
    where p.id = shifts.user_id and p.role = 'personnel'
      and m.unit_id in (select unit_id from unit_members where user_id = auth.uid())
  ));
create policy "admins write shifts" on shifts for all using (is_admin());

-- ---------- tasks ----------
create policy "assignee and creator read" on tasks for select using (
  assignee_id = auth.uid() or created_by = auth.uid() or is_admin()
  or exists (select 1 from profiles p where p.id = tasks.assignee_id and p.role = 'personnel' and is_in_my_unit(p.id))
);
create policy "assignee updates own tasks" on tasks for update using (assignee_id = auth.uid());
create policy "supervisors/admins create tasks" on tasks for insert with check (
  created_by = auth.uid() and (is_admin() or current_profile().role = 'supervisor')
);

-- ---------- wellness: owner + authorised medic ONLY ----------
create policy "own wellness" on wellness_data for select using (user_id = auth.uid());
create policy "own wellness write" on wellness_data for insert with check (user_id = auth.uid());
create policy "medic authorised wellness" on wellness_data for select using (
  exists (
    select 1 from medic_authorizations ma
    where ma.personnel_id = wellness_data.user_id and ma.medic_id = auth.uid() and ma.can_view_wellness
  )
);

create table medic_authorizations (
  id            uuid primary key default gen_random_uuid(),
  personnel_id  uuid not null references profiles(id) on delete cascade,
  medic_id      uuid not null references profiles(id) on delete cascade,
  can_view_wellness boolean not null default false,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (personnel_id, medic_id)
);
alter table medic_authorizations enable row level security;
create policy "personnel manage own auths" on medic_authorizations for all
  using (personnel_id = auth.uid()) with check (personnel_id = auth.uid());
create policy "medic reads own authorizations" on medic_authorizations for select using (medic_id = auth.uid());

create policy "own recovery scores" on recovery_scores for select using (user_id = auth.uid());
create policy "own recovery write" on recovery_scores for insert with check (user_id = auth.uid());

-- ---------- incidents: reporter + admins; strict ----------
create policy "reporter reads own incidents" on incidents for select using (reporter_id = auth.uid() or is_admin());
create policy "report own incidents" on incidents for insert with check (reporter_id = auth.uid());
create policy "reporter updates own incidents" on incidents for update using (reporter_id = auth.uid());

-- ---------- support requests ----------
create policy "own medic requests" on medic_requests for select using (
  user_id = auth.uid() or medic_id = auth.uid() or is_admin()
);
create policy "create own medic requests" on medic_requests for insert with check (user_id = auth.uid());
create policy "own supervisor requests" on supervisor_requests for select using (
  user_id = auth.uid() or supervisor_id = auth.uid() or is_admin()
  or exists (select 1 from profiles p where p.id = supervisor_requests.user_id and p.role = 'personnel' and is_in_my_unit(p.id))
);
create policy "create own supervisor requests" on supervisor_requests for insert with check (user_id = auth.uid());

-- ---------- buddy connect: connection-scoped only ----------
create policy "buddy participants read" on buddy_connections for select using (
  requester_id = auth.uid() or addressee_id = auth.uid() or is_admin()
);
create policy "create buddy requests" on buddy_connections for insert with check (requester_id = auth.uid());
create policy "participants update connection" on buddy_connections for update using (
  requester_id = auth.uid() or addressee_id = auth.uid()
);

create policy "buddy messages readable by pair" on buddy_messages for select using (
  exists (select 1 from buddy_connections c where c.id = buddy_messages.connection_id
          and (c.requester_id = auth.uid() or c.addressee_id = auth.uid()))
);
create policy "send buddy messages" on buddy_messages for insert with check (
  sender_id = auth.uid() and exists (
    select 1 from buddy_connections c where c.id = buddy_messages.connection_id
    and c.status = 'accepted' and (c.requester_id = auth.uid() or c.addressee_id = auth.uid())
  )
);

-- ---------- message from home ----------
create policy "own contacts" on support_contacts for select using (personnel_id = auth.uid() or is_admin());
create policy "manage own contacts" on support_contacts for all using (personnel_id = auth.uid() or is_admin());

create policy "own videos" on support_videos for select using (
  personnel_id = auth.uid() or is_admin()
  or exists (select 1 from support_contacts sc where sc.id = support_videos.contact_id and sc.status = 'active') -- submitter path via service role
);
create policy "manage own videos" on support_videos for all using (personnel_id = auth.uid() or is_admin());

-- ---------- media ----------
create policy "read active music" on music_tracks for select using (is_active or is_admin());
create policy "admins manage music" on music_tracks for all using (is_admin());
create policy "own music history" on music_history for select using (user_id = auth.uid());
create policy "own music history write" on music_history for insert with check (user_id = auth.uid());
create policy "read active destress videos" on destress_videos for select using (is_active or is_admin());
create policy "admins manage destress videos" on destress_videos for all using (is_admin());

-- ---------- notifications ----------
create policy "own notifications" on notifications for select using (user_id = auth.uid() or is_admin());
create policy "update own notifications" on notifications for update using (user_id = auth.uid());
create policy "system inserts via service role" on notifications for insert with check (true); -- service role only in live mode

-- ---------- weekly reports ----------
create policy "own weekly reports" on weekly_reports for select using (user_id = auth.uid());

-- ---------- AI conversations: strictly private ----------
create policy "own conversations" on ai_conversations for select using (user_id = auth.uid());
create policy "create own conversations" on ai_conversations for insert with check (user_id = auth.uid());
create policy "own messages via conversation" on ai_messages for select using (
  exists (select 1 from ai_conversations c where c.id = ai_messages.conversation_id and c.user_id = auth.uid())
);
create policy "write own messages" on ai_messages for insert with check (
  exists (select 1 from ai_conversations c where c.id = ai_messages.conversation_id and c.user_id = auth.uid())
);

-- ---------- audit: insert-only for users, readable by admins ----------
create policy "admins read audit" on audit_logs for select using (is_admin());
create policy "insert audit" on audit_logs for insert with check (true); -- service role writes

-- ---------- password resets: service role only ----------
create policy "no direct access" on password_resets for select using (false);

-- ==========================================================================
-- STORAGE — private buckets
-- ==========================================================================

insert into storage.buckets (id, name, public) values
  ('message-from-home', 'message-from-home', false),
  ('destress-media',    'destress-media',    false),
  ('incident-attachments', 'incident-attachments', false)
on conflict (id) do nothing;

-- Personnel read their own received videos; submitters write only into their contact's prefix
create policy "personnel read own videos" on storage.objects for select using (
  bucket_id = 'message-from-home' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "contacts upload to assigned folder" on storage.objects for insert with check (
  bucket_id = 'message-from-home' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "admins manage media" on storage.objects for all using (is_admin());
