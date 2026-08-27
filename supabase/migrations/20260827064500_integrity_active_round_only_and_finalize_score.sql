create or replace function public.record_integrity_event(
  p_attempt uuid,
  p_event integrity_event_type,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_a public.attempts;
  v_count int;
  v_uid uuid := auth.uid();
  v_limit int;
  v_round_release timestamptz;
  v_score integer;
  v_time bigint;
begin
  select * into v_a from public.attempts where id=p_attempt for update;
  if v_a.id is null then raise exception 'attempt_not_found'; end if;
  if not exists(select 1 from public.event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;

  -- Integrity checks apply only while the participant is actively taking the round.
  if v_a.status <> 'active' or clock_timestamp() >= v_a.deadline_at then
    return jsonb_build_object(
      'ignored', true,
      'reason', case when v_a.status <> 'active' then 'attempt_not_active' else 'attempt_expired' end,
      'warning_count', v_a.warning_count,
      'terminated', false
    );
  end if;

  insert into public.integrity_events(event_id,attempt_id,participant_id,event,metadata)
  values(v_a.event_id,v_a.id,v_a.participant_id,p_event,p_metadata);

  v_count := v_a.warning_count + case when p_event in ('visibility_hidden','window_blur') then 1 else 0 end;
  v_limit := (select coalesce((settings->>'visibility_warning_limit')::int,2) from public.events where id=v_a.event_id);

  if p_event in ('visibility_hidden','window_blur') and v_count >= v_limit then
    select coalesce(sum(case when coalesce(is_void,false) then 0 else coalesce(points_awarded,0) end),0)::int,
           coalesce(sum(case when coalesce(is_void,false) then 0 else coalesce(response_time_ms,0) end),0)::bigint
    into v_score,v_time
    from public.responses
    where attempt_id=p_attempt;

    select r.results_released_at into v_round_release from public.rounds r where r.id=v_a.round_id;

    update public.attempts
    set warning_count=v_count,
        status='terminated',
        submitted_at=coalesce(submitted_at,clock_timestamp()),
        score=v_score,
        valid_response_time_ms=v_time,
        result_released_at=v_round_release,
        updated_at=clock_timestamp()
    where id=v_a.id;
  else
    update public.attempts
    set warning_count=v_count,updated_at=clock_timestamp()
    where id=v_a.id;
  end if;

  return jsonb_build_object(
    'ignored', false,
    'warning_count',v_count,
    'warning_limit',v_limit,
    'terminated',v_count>=v_limit and p_event in ('visibility_hidden','window_blur')
  );
end;
$function$;
