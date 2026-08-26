alter table public.rounds add column if not exists results_released_at timestamptz;

create or replace function public.finish_quiz_attempt(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare
  v_a public.attempts;
  v_uid uuid:=auth.uid();
  v_round_release timestamptz;
begin
  select * into v_a from public.attempts where id=p_attempt for update;
  if v_a.id is null then raise exception 'attempt_not_found'; end if;
  if not exists(select 1 from public.event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
  if v_a.status<>'active' then
    return jsonb_build_object('attempt_id',v_a.id,'status',v_a.status,'score',v_a.score,'result_released_at',v_a.result_released_at);
  end if;

  select r.results_released_at into v_round_release
  from public.rounds r where r.id=v_a.round_id;

  update public.attempts
  set status=case when clock_timestamp()>=deadline_at then 'timed_out'::attempt_status else 'completed'::attempt_status end,
      submitted_at=clock_timestamp(),
      result_released_at=v_round_release,
      updated_at=clock_timestamp()
  where id=p_attempt
  returning * into v_a;

  insert into public.audit_events(event_id,participant_id,round_id,event_type,action,metadata)
  values(v_a.event_id,v_a.participant_id,v_a.round_id,'round','attempt_finished',jsonb_build_object('attempt_id',p_attempt,'score',v_a.score,'result_released_at',v_a.result_released_at));

  return jsonb_build_object('attempt_id',v_a.id,'status',v_a.status,'score',v_a.score,'result_released_at',v_a.result_released_at);
end; $$;

create or replace function public.release_round_results(p_event_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_n int := 0;
  v_round public.rounds%rowtype;
  v_release timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not private.is_event_admin(p_event_id) then
    raise exception 'forbidden';
  end if;

  select * into v_round from public.rounds where id=p_round_id and event_id=p_event_id for update;
  if not found then raise exception 'round_not_found'; end if;
  if v_round.status not in ('closed','open') then raise exception 'round_must_be_open_or_closed_to_release'; end if;

  update public.rounds
  set status='closed',
      closed_at=coalesce(closed_at,v_release),
      results_released_at=coalesce(results_released_at,v_release)
  where id=p_round_id
  returning results_released_at into v_release;

  update public.attempts
  set result_released_at=v_release,
      updated_at=clock_timestamp()
  where event_id=p_event_id and round_id=p_round_id and result_released_at is distinct from v_release;
  get diagnostics v_n = row_count;

  insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata)
  values(p_event_id,auth.uid(),p_round_id,'round','release_round_results',jsonb_build_object('round_id',p_round_id,'attempts_released',v_n,'released_at',v_release));

  return jsonb_build_object('ok',true,'attempts_released',v_n,'round_id',p_round_id,'released_at',v_release);
end; $$;

revoke all on function public.release_round_results(uuid,uuid) from public;
grant execute on function public.release_round_results(uuid,uuid) to authenticated;
