-- P1 production hardening.
-- 1) Participant PII/responses are visible only to super admins.
-- 2) Remove the obsolete automatic result-release delay setting.
-- 3) Finalist tie-break time is calculated from the same best five rounds that contribute score.

create or replace function private.require_super_admin(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.event_admins ea
    where ea.event_id=p_event_id
      and ea.user_id=auth.uid()
      and ea.role::text='super_admin'
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

revoke all on function private.require_super_admin(uuid) from public,anon;
grant execute on function private.require_super_admin(uuid) to authenticated;

create or replace function public.admin_participant_roster(p_event_id uuid)
returns table(
  participant_id uuid,
  user_id uuid,
  display_name text,
  full_name text,
  email text,
  mobile_e164 text,
  institution text,
  designation text,
  department text,
  registered_at timestamptz,
  is_finalist boolean,
  attempts_count bigint,
  answered_count bigint,
  correct_count bigint,
  total_score bigint
)
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
begin
  perform private.require_super_admin(p_event_id);

  return query
  select
    ep.id,
    ep.user_id,
    ep.display_name,
    p.full_name,
    p.email,
    p.mobile_e164,
    p.institution,
    p.designation,
    p.department,
    ep.registered_at,
    ep.is_finalist,
    count(distinct a.id)::bigint,
    count(r.id)::bigint,
    count(r.id) filter (where r.is_correct is true)::bigint,
    coalesce(sum(r.points_awarded),0)::bigint
  from public.event_participants ep
  left join public.profiles p on p.id=ep.user_id
  left join public.attempts a on a.participant_id=ep.id and a.event_id=p_event_id
  left join public.responses r on r.attempt_id=a.id and coalesce(r.is_void,false)=false
  where ep.event_id=p_event_id
  group by ep.id,ep.user_id,ep.display_name,p.full_name,p.email,p.mobile_e164,p.institution,p.designation,p.department,ep.registered_at,ep.is_finalist
  order by ep.registered_at asc;
end;
$$;

create or replace function public.admin_participant_responses(p_event_id uuid,p_participant_id uuid)
returns table(
  attempt_id uuid,
  attempt_status text,
  attempt_score integer,
  round_id uuid,
  round_number integer,
  round_title text,
  question_id uuid,
  displayed_position smallint,
  stem text,
  selected_option_key text,
  selected_option_text text,
  correct_option_key text,
  correct_option_text text,
  is_correct boolean,
  points_awarded integer,
  response_time_ms bigint,
  response_submitted_at timestamptz
)
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
begin
  perform private.require_super_admin(p_event_id);
  if not exists(select 1 from public.event_participants ep where ep.id=p_participant_id and ep.event_id=p_event_id) then
    raise exception 'participant_not_found';
  end if;

  return query
  select
    a.id,
    a.status::text,
    a.score,
    rd.id,
    rd.round_number,
    rd.title,
    q.id,
    r.displayed_position,
    q.stem,
    r.selected_option_key,
    so.option_text,
    co.option_key,
    co.option_text,
    r.is_correct,
    r.points_awarded,
    r.response_time_ms,
    r.submitted_at
  from public.attempts a
  join public.rounds rd on rd.id=a.round_id
  left join public.responses r on r.attempt_id=a.id and coalesce(r.is_void,false)=false
  left join public.questions q on q.id=r.question_id
  left join public.question_options so on so.question_id=r.question_id and so.option_key=r.selected_option_key
  left join lateral (
    select qo.option_key,qo.option_text
    from public.question_options qo
    where qo.question_id=r.question_id and qo.is_correct is true
    order by qo.option_key
    limit 1
  ) co on true
  where a.event_id=p_event_id and a.participant_id=p_participant_id
  order by rd.round_number asc,a.started_at asc,r.displayed_position asc nulls last;
end;
$$;

revoke all on function public.admin_participant_roster(uuid) from public,anon;
revoke all on function public.admin_participant_responses(uuid,uuid) from public,anon;
grant execute on function public.admin_participant_roster(uuid) to authenticated;
grant execute on function public.admin_participant_responses(uuid,uuid) to authenticated;

update public.events
set settings = coalesce(settings,'{}'::jsonb) - 'result_release_delay_seconds',
    updated_at = clock_timestamp()
where coalesce(settings,'{}'::jsonb) ? 'result_release_delay_seconds';

create or replace function public.qualify_finalists(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_count integer;
begin
  perform private.require_control_lock(p_event_id);
  delete from finalists where event_id=p_event_id;

  with eligible as (
    select
      ep.id as participant_id,
      a.id as attempt_id,
      a.score,
      a.valid_response_time_ms,
      row_number() over (
        partition by ep.id
        order by a.score desc, a.valid_response_time_ms asc, a.id
      ) as score_rank
    from event_participants ep
    left join attempts a
      on a.event_id=p_event_id
     and a.participant_id=ep.id
     and a.status in ('completed','terminated','timed_out','recovered')
    where ep.event_id=p_event_id
  ), scores as (
    select
      participant_id,
      coalesce(sum(score) filter (where score_rank<=5),0)::integer as preliminary_score,
      coalesce(sum(valid_response_time_ms) filter (where score_rank<=5),0)::bigint as preliminary_time_ms
    from eligible
    group by participant_id
  ), ranked as (
    select
      participant_id,
      preliminary_score,
      preliminary_time_ms,
      row_number() over (
        order by preliminary_score desc, preliminary_time_ms asc, participant_id
      ) as rank
    from scores
  ), top10 as (
    select * from ranked order by rank limit 10
  )
  insert into finalists(event_id,participant_id,preliminary_score,preliminary_time_ms,rank)
  select p_event_id,participant_id,preliminary_score,preliminary_time_ms,rank
  from top10;

  update event_participants ep
  set is_finalist = exists(
    select 1 from finalists f where f.event_id=p_event_id and f.participant_id=ep.id
  )
  where ep.event_id=p_event_id;

  select count(*) into v_count from finalists where event_id=p_event_id;
  update events set status='final',updated_at=clock_timestamp() where id=p_event_id;
  insert into audit_events(event_id,actor_user_id,event_type,action,metadata)
  values(p_event_id,auth.uid(),'scoring','qualify_finalists',jsonb_build_object('count',v_count,'ranking','best5_score_then_best5_time'));
  return jsonb_build_object('finalists',v_count);
end;
$function$;
