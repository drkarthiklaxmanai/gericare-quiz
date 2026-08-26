-- P0 competition correctness hardening.
-- 1) Negative marking is server-authoritative and configurable per event.
-- 2) Result release is manual only, including integrity termination.
-- 3) Draft-round questions accidentally left as `used` are restored to `approved`.

update public.events
set settings = (coalesce(settings, '{}'::jsonb) - 'result_release_delay_seconds')
  || jsonb_build_object(
    'round_duration_seconds', 90,
    'wrong_answer_points', -5
  ),
  updated_at = clock_timestamp();

-- A used question attached only to a not-yet-run draft round is stale state,
-- not a genuinely consumed question. Do not touch questions used by open/closed rounds.
update public.questions q
set status = 'approved',
    used_at = null,
    updated_at = clock_timestamp()
where q.status = 'used'
  and exists (
    select 1
    from public.round_questions rq
    join public.rounds r on r.id = rq.round_id
    where rq.question_id = q.id
      and r.status = 'draft'
      and not exists (
        select 1 from public.attempts a where a.round_id = r.id
      )
  )
  and not exists (
    select 1
    from public.round_questions rq2
    join public.rounds r2 on r2.id = rq2.round_id
    where rq2.question_id = q.id
      and r2.status in ('open','closed')
  );

create or replace function public.submit_quiz_response(
  p_attempt uuid,
  p_question uuid,
  p_option text,
  p_client_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_a attempts%rowtype;
  v_uid uuid := auth.uid();
  v_q questions%rowtype;
  v_correct boolean;
  v_award integer;
  v_wrong_points integer;
  v_started timestamptz;
  v_submitted timestamptz := clock_timestamp();
  v_time bigint;
  v_pos smallint;
begin
  select * into v_a from attempts where id = p_attempt for update;
  if v_a.id is null then raise exception 'attempt_not_found'; end if;
  if not exists(select 1 from event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
  if v_a.status <> 'active' then raise exception 'attempt_not_active'; end if;
  if v_submitted > v_a.deadline_at then raise exception 'attempt_expired'; end if;
  if p_option not in ('A','B','C','D') then raise exception 'invalid_option'; end if;

  select (x->>'position')::smallint into v_pos
  from jsonb_array_elements(v_a.question_manifest) x
  where x->>'question_id' = p_question::text;
  if v_pos is null then raise exception 'question_not_in_attempt'; end if;

  select * into v_q from questions where id = p_question;
  if v_q.id is null then raise exception 'question_not_found'; end if;

  select is_correct into v_correct
  from question_options
  where question_id = p_question and option_key = p_option;
  if v_correct is null then raise exception 'option_not_found'; end if;

  select coalesce((e.settings->>'wrong_answer_points')::int, -5)
  into v_wrong_points
  from events e where e.id = v_a.event_id;
  v_award := case when v_correct then v_q.points else v_wrong_points end;

  select question_started_at into v_started
  from responses
  where attempt_id = p_attempt and question_id = p_question
  for update;
  if v_started is null then v_started := v_a.started_at; end if;

  if exists(select 1 from responses where attempt_id=p_attempt and question_id=p_question and submitted_at is not null) then
    raise exception 'response_already_submitted';
  end if;

  v_time := greatest(0, extract(epoch from (v_submitted-v_started))*1000)::bigint;

  update responses
  set selected_option_key = p_option,
      submitted_at = v_submitted,
      response_time_ms = v_time,
      is_correct = v_correct,
      points_awarded = v_award
  where attempt_id = p_attempt and question_id = p_question;

  if not found then
    insert into responses(
      attempt_id,question_id,displayed_position,selected_option_key,
      question_started_at,submitted_at,response_time_ms,is_correct,points_awarded
    ) values (
      p_attempt,p_question,v_pos,p_option,
      v_started,v_submitted,v_time,v_correct,v_award
    );
  end if;

  update attempts
  set score = score + v_award,
      valid_response_time_ms = valid_response_time_ms + v_time,
      updated_at = clock_timestamp()
  where id = p_attempt;

  insert into audit_events(event_id,participant_id,round_id,event_type,action,metadata)
  values(v_a.event_id,v_a.participant_id,v_a.round_id,'response','answer_submitted',
    jsonb_build_object('attempt_id',p_attempt,'question_id',p_question,'points',v_award));

  return jsonb_build_object(
    'accepted',true,
    'is_correct',v_correct,
    'points',v_award,
    'submitted_at',v_submitted,
    'response_time_ms',v_time
  );
end;
$function$;

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
begin
  select * into v_a from public.attempts where id=p_attempt for update;
  if v_a.id is null then raise exception 'attempt_not_found'; end if;
  if not exists(select 1 from public.event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;

  insert into public.integrity_events(event_id,attempt_id,participant_id,event,metadata)
  values(v_a.event_id,v_a.id,v_a.participant_id,p_event,p_metadata);

  v_count := v_a.warning_count + case when p_event in ('visibility_hidden','window_blur') then 1 else 0 end;
  v_limit := (select coalesce((settings->>'visibility_warning_limit')::int,2) from public.events where id=v_a.event_id);

  if p_event in ('visibility_hidden','window_blur') and v_count >= v_limit then
    select r.results_released_at into v_round_release from public.rounds r where r.id=v_a.round_id;
    update public.attempts
    set warning_count=v_count,
        status='terminated',
        submitted_at=coalesce(submitted_at,clock_timestamp()),
        result_released_at=v_round_release,
        updated_at=clock_timestamp()
    where id=v_a.id;
  else
    update public.attempts
    set warning_count=v_count,updated_at=clock_timestamp()
    where id=v_a.id;
  end if;

  return jsonb_build_object(
    'warning_count',v_count,
    'terminated',v_count>=v_limit and p_event in ('visibility_hidden','window_blur')
  );
end;
$function$;
