alter table public.global_announcements
  add column if not exists title_translations jsonb not null default '{}'::jsonb,
  add column if not exists body_translations jsonb not null default '{}'::jsonb;

-- The existing welcome announcement was authored only in Spanish.
update public.global_announcements
set title_translations = '{"es":"Bienvenidos","en":"Welcome","ko":"환영합니다"}'::jsonb,
    body_translations = '{"es":"BIENVENIDOS A DAEHAN APP","en":"WELCOME TO DAEHAN APP","ko":"DAEHAN 앱에 오신 것을 환영합니다"}'::jsonb
where title = 'Bienvenidos' and body = 'BIENVENIDOS A DAEHAN APP'
  and title_translations = '{}'::jsonb and body_translations = '{}'::jsonb;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'global_announcements') then
    alter publication supabase_realtime add table public.global_announcements;
  end if;
end $$;
