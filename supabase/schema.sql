-- ==========================================================================
-- VIGIL AI — PostgreSQL / Supabase schema (live-mode target)
-- Demo mode mirrors these table names in server/data_store.py.
-- Run in the Supabase SQL editor. policies.sql adds RLS afterwards.
-- ==========================================================================

create extension if not exists "pgcrypto";

-- ---------- ENUMS ----------
create type user_role    as enum ('personnel', 'medic', 'supervisor', 'admin');
create type user_status  as enum ('active', 'suspended');
create type unit_role    as enum ('member', 'lead');

-- ---------- IDENTITY ----------
create table profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  email         citext not null unique,
  full_name     text not null check (char_length(full_name) between 2 and 80),
  role          user_role not null default 'personnel',
  status        user_status not null default 'active',
  unit_id       uuid,
  phone         text check (phone ~ '^[0-9+()\-\s]{0,20}$'),
  avatar_color  text not null default 'teal' check (avatar_color in ('teal','blue','violet','amber','rose','green')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table units (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (char_length(name) between 2 and 80),
  description  text default '',
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

alter table profiles
  add constraint profiles_unit_fk foreign key (unit_id) references units(id) on delete set null;

create table unit_members (
  unit_id   uuid not null references units(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  role_in_unit unit_role not null default 'member',
  added_at  timestamptz not null default now(),
  primary key (unit_id, user_id)
);

create index unit_members_user_idx on unit_members(user_id);

-- ---------- SHIFTS (Phase 3) ----------
create table shifts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  shift_type    text not null default 'duty' check (shift_type in ('duty','standby','rest','leave')),
  status        text not null default 'scheduled' check (status in ('scheduled','active','completed','missed')),
  break_minutes int check (break_minutes >= 0),
  notes         text,
  created_at    timestamptz not null default now(),
  constraint shifts_time_order check (end_at > start_at)
);
create index shifts_user_time_idx on shifts(user_id, start_at desc);

-- ---------- TASKS (Phase 4) ----------
create table tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 2 and 160),
  description   text default '',
  assignee_id   uuid not null references profiles(id) on delete cascade,
  created_by    uuid not null references profiles(id) on delete cascade,
  unit_id       uuid references units(id) on delete set null,
  priority      text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status        text not null default 'pending' check (status in ('pending','in_progress','blocked','completed','cancelled')),
  progress      int not null default 0 check (progress between 0 and 100),
  due_at        timestamptz,
  remarks       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tasks_assignee_idx on tasks(assignee_id, status);
create index tasks_due_idx on tasks(due_at);

-- ---------- WELLNESS (Phases 5–6, simulated in demo) ----------
create table wellness_data (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  source      text not null default 'simulated' check (source in ('simulated','device','manual')),
  heart_rate  int check (heart_rate between 20 and 250),
  spo2        int check (spo2 between 50 and 100),
  sleep_minutes int check (sleep_minutes between 0 and 1440),
  sleep_quality int check (sleep_quality between 1 and 5),
  steps       int check (steps >= 0),
  stress_self_report int check (stress_self_report between 1 and 5)
);
create index wellness_user_time_idx on wellness_data(user_id, recorded_at desc);

create table recovery_scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  computed_at timestamptz not null default now(),
  score       int not null check (score between 0 and 100),
  factors     jsonb not null default '{}'::jsonb,
  explanation text
);
create index recovery_user_time_idx on recovery_scores(user_id, computed_at desc);

-- ---------- SUPPORT REQUESTS (Phases 12–13) ----------
create table medic_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  medic_id     uuid references profiles(id) on delete set null,
  category     text not null check (category in ('injury','illness','mental_health','medication','follow_up','other')),
  description  text not null check (char_length(description) between 3 and 2000),
  status       text not null default 'open' check (status in ('open','acknowledged','in_progress','resolved','declined')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index medic_requests_user_idx on medic_requests(user_id, created_at desc);
create index medic_requests_medic_idx on medic_requests(medic_id, status);

create table supervisor_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  supervisor_id uuid references profiles(id) on delete set null,
  category      text not null check (category in ('work_issue','shift_concern','task_concern','general_support')),
  description   text not null check (char_length(description) between 3 and 2000),
  status        text not null default 'open' check (status in ('open','acknowledged','in_progress','resolved','declined')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index supervisor_requests_user_idx on supervisor_requests(user_id, created_at desc);

-- ---------- BUDDY CONNECT (Phase 10) ----------
create table buddy_connections (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references profiles(id) on delete cascade,
  addressee_id  uuid not null references profiles(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted','declined','removed')),
  share_scope   jsonb not null default '{}'::jsonb, -- explicit opt-in flags only
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint buddy_not_self check (requester_id <> addressee_id),
  constraint buddy_unique_pair unique (requester_id, addressee_id)
);

create table buddy_messages (
  id          uuid primary key default gen_random_uuid(),
  connection_id uuid not null references buddy_connections(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index buddy_messages_conn_idx on buddy_messages(connection_id, created_at);

-- ---------- MESSAGE FROM HOME (Phase 11) ----------
create table support_contacts (
  id          uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  relationship text default '',
  invite_code uuid not null default gen_random_uuid(),
  status      text not null default 'invited' check (status in ('invited','active','removed')),
  created_at  timestamptz not null default now()
);
create index support_contacts_personnel_idx on support_contacts(personnel_id);

create table support_videos (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references support_contacts(id) on delete cascade,
  personnel_id uuid not null references profiles(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  message      text default '',
  storage_path text not null,
  duration_sec int,
  watched_at   timestamptz,
  hidden_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index support_videos_personnel_idx on support_videos(personnel_id, created_at desc);

-- ---------- INCIDENTS (Phase 14) ----------
create table incidents (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references profiles(id) on delete cascade,
  incident_type  text not null check (incident_type in ('operational','safety','trauma','near_miss','other')),
  occurred_on    date not null,
  occurred_at    time,
  location       text,
  description    text not null check (char_length(description) between 5 and 5000),
  people_involved text,
  severity       text not null check (severity in ('low','medium','high','critical')),
  immediate_action text,
  status         text not null default 'submitted' check (status in ('submitted','under_review','action_taken','resolved','closed')),
  resolution     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index incidents_reporter_idx on incidents(reporter_id, created_at desc);
create index incidents_status_idx on incidents(status);

-- ---------- MEDIA (Phase 9) ----------
create table music_tracks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  artist      text default 'VIGIL AI',
  category    text not null check (category in ('calm','relaxation','focus','sleep','ambient','comfort')),
  storage_path text not null,
  duration_sec int not null,
  is_active   boolean not null default true,
  uploaded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index music_category_idx on music_tracks(category, is_active);

create table music_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  track_id   uuid not null references music_tracks(id) on delete cascade,
  played_at  timestamptz not null default now()
);
create index music_history_user_idx on music_history(user_id, played_at desc);

create table destress_videos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null check (category in ('breathing','relaxation','mindfulness','stretching','sleep','positive')),
  storage_path text not null,
  duration_sec int not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- NOTIFICATIONS (Phase 15) ----------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null default 'system' check (kind in ('shift','task','support','system','buddy','message_home','incident','medic_request','medic_message','medic_status','wellness_auth','supervisor_request','supervisor_message','supervisor_status')),
  title      text not null,
  body       text not null default '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);
create index notifications_unread_idx on notifications(user_id) where read_at is null;

-- ---------- WEEKLY REPORTS (Phase 7) ----------
create table weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  week_start   date not null,
  metrics      jsonb not null default '{}'::jsonb,
  ai_summary   text,
  created_at   timestamptz not null default now(),
  constraint weekly_reports_unique_week unique (user_id, week_start)
);

-- ---------- AI (Phase 8) ----------
create table ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  title      text default 'New conversation',
  created_at timestamptz not null default now()
);
create index ai_conversations_user_idx on ai_conversations(user_id);

create table ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index ai_messages_conv_idx on ai_messages(conversation_id, created_at);

-- ---------- AUDIT ----------
create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references profiles(id) on delete set null,
  action     text not null,
  target     text,
  detail     jsonb default '{}'::jsonb,
  ip         inet,
  created_at timestamptz not null default now()
);
create index audit_logs_time_idx on audit_logs(created_at desc);
create index audit_logs_actor_idx on audit_logs(actor_id, created_at desc);

-- ---------- MEDIC CONNECTION (Phase 12) ----------
create table medic_request_messages (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references medic_requests(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index medic_request_messages_request_idx on medic_request_messages(request_id, created_at);

create table wellness_authorizations (
  id           uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references profiles(id) on delete cascade,
  medic_id     uuid not null references profiles(id) on delete cascade,
  authorized   boolean not null default false,
  updated_at   timestamptz not null default now(),
  unique (personnel_id, medic_id)
);
create index wellness_auth_personnel_idx on wellness_authorizations(personnel_id);

create table supervisor_request_messages (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references supervisor_requests(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index supervisor_request_messages_request_idx on supervisor_request_messages(request_id, created_at);

create table incident_updates (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index incident_updates_incident_idx on incident_updates(incident_id, created_at);

-- ---------- AUTH SUPPORT ----------
create table password_resets (
  token      uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- ---------- TRIGGERS ----------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

create trigger profiles_touch before update on profiles for each row execute function touch_updated_at();
create trigger tasks_touch before update on tasks for each row execute function touch_updated_at();
create trigger incidents_touch before update on incidents for each row execute function touch_updated_at();
create trigger medic_requests_touch before update on medic_requests for each row execute function touch_updated_at();
create trigger supervisor_requests_touch before update on supervisor_requests for each row execute function touch_updated_at();
create trigger buddy_connections_touch before update on buddy_connections for each row execute function touch_updated_at();
