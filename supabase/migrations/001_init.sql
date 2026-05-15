create extension if not exists pg_trgm;

create table sounds (
  id            uuid primary key default gen_random_uuid(),
  drive_id      text not null unique,
  name          text not null,
  name_clean    text not null,
  category      text not null,
  tags          text[] not null default '{}',
  extension     text not null,
  web_view_link text not null,
  download_link text not null,
  file_size     bigint,
  modified_in_drive timestamptz,
  indexed_at    timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(category, '') || ' ' ||
      coalesce(name_clean, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  ) stored
);

create index idx_sounds_fts      on sounds using gin(search_vector);
create index idx_sounds_tags     on sounds using gin(tags);
create index idx_sounds_category on sounds(category);

create table sync_log (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  files_upserted int default 0,
  files_deleted  int default 0,
  status         text default 'running',
  error          text
);

alter table sounds   enable row level security;
alter table sync_log enable row level security;

create policy "public read" on sounds for select using (true);
create policy "public read" on sync_log for select using (true);
