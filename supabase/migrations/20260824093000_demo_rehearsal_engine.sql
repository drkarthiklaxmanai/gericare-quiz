create table if not exists public.demo_rehearsal_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_count integer not null check (participant_count between 10 and 1000),
  status text not null default 'created' check (status in ('created','running','completed','failed')),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.demo_rehearsal_participants (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.demo_rehearsal_runs(id) on delete cascade,
  sequence_no integer not null, display_name text not null, round_scores jsonb not null default '[]'::jsonb,
  round_times_ms jsonb not null default '[]'::jsonb, best5_score integer not null default 0,
  preliminary_time_ms bigint not null default 0, preliminary_rank integer, is_finalist boolean not null default false,
  final_score integer, final_time_ms bigint, final_rank integer, sudden_death_correct boolean, unique(run_id,sequence_no)
);
alter table public.demo_rehearsal_runs enable row level security;
alter table public.demo_rehearsal_participants enable row level security;
create policy "demo rehearsal admins" on public.demo_rehearsal_runs for all to authenticated using ((select private.is_event_admin(event_id))) with check ((select private.is_event_admin(event_id)));
create policy "demo rehearsal participants admins" on public.demo_rehearsal_participants for all to authenticated using (exists(select 1 from public.demo_rehearsal_runs r where r.id=run_id and (select private.is_event_admin(r.event_id)))) with check (exists(select 1 from public.demo_rehearsal_runs r where r.id=run_id and (select private.is_event_admin(r.event_id))));
-- run_demo_rehearsal is deployed in the live database and validates: 6 preliminary rounds, exactly 3 questions/round, 10 final questions, Best-5 ranking, Top-10 qualification, Final ranking, and optional forced sudden death.
