-- Participant results/Q&A must remain hidden until the quiz master explicitly releases the round.
-- Finishing an attempt no longer schedules an automatic release timestamp.

create or replace function public.finish_quiz_attempt(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_a public.attempts;
  v_uid uuid := auth.uid();
begin
  select * into v_a
  from public.attempts
  where id = p_attempt
  for update;

  if v_a.id is null then
    raise exception 'attempt_not_found';
  end if;

  if not exists (
    select 1
    from public.event_participants ep
    where ep.id = v_a.participant_id
      and ep.user_id = v_uid
  ) then
    raise exception 'forbidden';
  end if;

  if v_a.status <> 'active' then
    return jsonb_build_object(
      'attempt_id', v_a.id,
      'status', v_a.status,
      'score', v_a.score,
      'result_released_at', v_a.result_released_at
    );
  end if;

  update public.attempts
  set status = case
        when clock_timestamp() >= deadline_at then 'timed_out'::attempt_status
        else 'completed'::attempt_status
      end,
      submitted_at = clock_timestamp(),
      result_released_at = null,
      updated_at = clock_timestamp()
  where id = p_attempt
  returning * into v_a;

  insert into public.audit_events(
    event_id, participant_id, round_id, event_type, action, metadata
  ) values (
    v_a.event_id,
    v_a.participant_id,
    v_a.round_id,
    'round',
    'attempt_finished',
    jsonb_build_object(
      'attempt_id', p_attempt,
      'score', v_a.score,
      'results_pending_manual_release', true
    )
  );

  return jsonb_build_object(
    'attempt_id', v_a.id,
    'status', v_a.status,
    'score', v_a.score,
    'result_released_at', null
  );
end;
$$;

-- Cancel any previously scheduled-but-not-yet-released automatic releases.
update public.attempts
set result_released_at = null,
    updated_at = clock_timestamp()
where result_released_at > clock_timestamp();
