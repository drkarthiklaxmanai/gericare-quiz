create table if not exists public.presentation_state (
  event_id uuid primary key references public.events(id) on delete cascade,
  state text not null default 'WAITING' check (state in ('WAITING','RULES','QUESTION','ANSWER_REVEAL','EXPLANATION','ROUND_TOP10','LEADERBOARD','FINAL','WINNER')),
  round_id uuid references public.rounds(id) on delete set null,
  round_number integer,
  title text,
  question text,
  options jsonb not null default '[]'::jsonb,
  answer text,
  explanation text,
  top10 jsonb not null default '[]'::jsonb,
  media jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.presentation_state enable row level security;
drop policy if exists "presentation admins read" on public.presentation_state;
create policy "presentation admins read" on public.presentation_state for select to authenticated using ((select private.is_event_admin(event_id)));
drop policy if exists "presentation projector read" on public.presentation_state;
create policy "presentation projector read" on public.presentation_state for select to authenticated using (true);
create or replace function public.publish_presentation_state(
  p_event_id uuid,
  p_state text,
  p_round_id uuid default null,
  p_title text default null,
  p_question text default null,
  p_options jsonb default '[]'::jsonb,
  p_answer text default null,
  p_explanation text default null,
  p_top10 jsonb default '[]'::jsonb,
  p_media jsonb default '[]'::jsonb
) returns public.presentation_state
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.presentation_state%rowtype; v_round integer;
begin
 if auth.uid() is null or not private.is_event_admin(p_event_id) then raise exception 'Forbidden'; end if;
 if p_state not in ('WAITING','RULES','QUESTION','ANSWER_REVEAL','EXPLANATION','ROUND_TOP10','LEADERBOARD','FINAL','WINNER') then raise exception 'Invalid presentation state'; end if;
 if p_round_id is not null then select round_number into v_round from public.rounds where id=p_round_id and event_id=p_event_id; end if;
 insert into public.presentation_state(event_id,state,round_id,round_number,title,question,options,answer,explanation,top10,media,updated_by,updated_at)
 values(p_event_id,p_state,p_round_id,v_round,p_title,p_question,coalesce(p_options,'[]'::jsonb),p_answer,p_explanation,coalesce(p_top10,'[]'::jsonb),coalesce(p_media,'[]'::jsonb),auth.uid(),now())
 on conflict(event_id) do update set state=excluded.state,round_id=excluded.round_id,round_number=excluded.round_number,title=excluded.title,question=excluded.question,options=excluded.options,answer=excluded.answer,explanation=excluded.explanation,top10=excluded.top10,media=excluded.media,updated_by=excluded.updated_by,updated_at=excluded.updated_at
 returning * into v_row;
 insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(p_event_id,auth.uid(),p_round_id,'projector','presentation_state_published',jsonb_build_object('state',p_state));
 return v_row;
end;$$;
revoke all on function public.publish_presentation_state(uuid,text,uuid,text,text,jsonb,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.publish_presentation_state(uuid,text,uuid,text,text,jsonb,text,text,jsonb,jsonb) to authenticated;
alter publication supabase_realtime add table public.presentation_state;
