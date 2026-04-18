-- Deal Intelligence OS
-- Supabase Postgres bootstrap SQL
-- Run this in Supabase SQL Editor before pointing the backend at Supabase.

create extension if not exists pgcrypto;

create table if not exists "user" (
  id uuid primary key default gen_random_uuid(),
  email varchar not null unique,
  password_hash varchar,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  last_seen_at timestamptz,
  last_login_ip varchar not null default '',
  last_seen_ip varchar not null default '',
  login_count integer not null default 0,
  request_count integer not null default 0,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  is_blacklisted boolean not null default false,
  blacklist_reason varchar not null default '',
  blacklisted_at timestamptz,
  plan varchar not null default 'free',
  enterprise_enabled_at timestamptz,
  enterprise_owner_id uuid references "user"(id),
  employee_limit integer not null default 0,
  enterprise_member_role varchar not null default '',
  token_version integer not null default 0,
  password_changed_at timestamptz,
  llm_provider varchar not null default '',
  llm_api_key varchar not null default '',
  llm_model varchar not null default '',
  llm_allocated_at timestamptz
);

create index if not exists ix_user_email on "user"(email);
create index if not exists ix_user_enterprise_owner_id on "user"(enterprise_owner_id);

create table if not exists profile (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references "user"(id),
  full_name varchar not null default '',
  phone varchar,
  whatsapp varchar,
  company varchar not null default '',
  city varchar not null default '',
  areas_served varchar not null default '',
  specialization varchar not null default '',
  rera_id varchar not null default '',
  pan varchar not null default '',
  gstin varchar not null default '',
  languages varchar not null default '',
  bio varchar not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_profile_owner_id on profile(owner_id);

create table if not exists contact (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references "user"(id),
  enterprise_owner_id uuid references "user"(id),
  created_by_user_id uuid references "user"(id),
  name varchar not null,
  occupation varchar not null default '',
  phone varchar,
  email varchar,
  role varchar not null default 'buyer',
  tags varchar not null default '',
  notes varchar not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_contact_owner_id on contact(owner_id);
create index if not exists ix_contact_enterprise_owner_id on contact(enterprise_owner_id);
create index if not exists ix_contact_created_by_user_id on contact(created_by_user_id);

create table if not exists deal (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references "user"(id),
  enterprise_owner_id uuid references "user"(id),
  created_by_user_id uuid references "user"(id),
  title varchar not null,
  asset_type varchar not null default 'residential',
  stage varchar not null default 'lead',
  city varchar not null default '',
  area varchar not null default '',
  visit_date date,
  typology varchar not null default '',
  ticket_size double precision,
  customer_budget double precision,
  expected_yield_pct double precision,
  expected_roi_pct double precision,
  liquidity_days_est integer,
  client_phase varchar not null default '',
  close_probability integer,
  risk_flags varchar not null default '',
  contact_id uuid references contact(id),
  notes varchar not null default '',
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_deal_owner_id on deal(owner_id);
create index if not exists ix_deal_enterprise_owner_id on deal(enterprise_owner_id);
create index if not exists ix_deal_created_by_user_id on deal(created_by_user_id);
create index if not exists ix_deal_contact_id on deal(contact_id);
create index if not exists ix_deal_stage on deal(stage);
create index if not exists ix_deal_city_area on deal(city, area);
create index if not exists ix_deal_client_phase on deal(client_phase);

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references "user"(id),
  enterprise_owner_id uuid references "user"(id),
  created_by_user_id uuid references "user"(id),
  deal_id uuid references deal(id),
  contact_id uuid references contact(id),
  kind varchar not null default 'whatsapp',
  summary varchar not null default '',
  due_at timestamptz,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ix_activity_owner_id on activity(owner_id);
create index if not exists ix_activity_enterprise_owner_id on activity(enterprise_owner_id);
create index if not exists ix_activity_created_by_user_id on activity(created_by_user_id);
create index if not exists ix_activity_deal_id on activity(deal_id);
create index if not exists ix_activity_contact_id on activity(contact_id);

create table if not exists dealstageevent (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references "user"(id),
  enterprise_owner_id uuid references "user"(id),
  created_by_user_id uuid references "user"(id),
  deal_id uuid not null references deal(id),
  from_stage varchar not null default '',
  to_stage varchar not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ix_dealstageevent_owner_id on dealstageevent(owner_id);
create index if not exists ix_dealstageevent_enterprise_owner_id on dealstageevent(enterprise_owner_id);
create index if not exists ix_dealstageevent_created_by_user_id on dealstageevent(created_by_user_id);
create index if not exists ix_dealstageevent_deal_id on dealstageevent(deal_id);
create index if not exists ix_dealstageevent_created_at on dealstageevent(created_at);

create table if not exists auditevent (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references "user"(id),
  target_user_id uuid references "user"(id),
  enterprise_owner_id uuid references "user"(id),
  kind varchar not null,
  summary varchar not null default '',
  detail varchar not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ix_auditevent_actor_user_id on auditevent(actor_user_id);
create index if not exists ix_auditevent_target_user_id on auditevent(target_user_id);
create index if not exists ix_auditevent_enterprise_owner_id on auditevent(enterprise_owner_id);
create index if not exists ix_auditevent_kind on auditevent(kind);
create index if not exists ix_auditevent_created_at on auditevent(created_at);

create table if not exists supportchatmessage (
  id uuid primary key default gen_random_uuid(),
  enterprise_owner_id uuid not null references "user"(id),
  sender_user_id uuid references "user"(id),
  sender_role varchar not null default 'enterprise_owner',
  message varchar not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ix_supportchatmessage_enterprise_owner_id on supportchatmessage(enterprise_owner_id);
create index if not exists ix_supportchatmessage_sender_user_id on supportchatmessage(sender_user_id);
create index if not exists ix_supportchatmessage_sender_role on supportchatmessage(sender_role);
create index if not exists ix_supportchatmessage_created_at on supportchatmessage(created_at);
