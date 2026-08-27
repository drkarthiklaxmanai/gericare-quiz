create or replace function public.close_round(p_event_id uuid, p_round_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $function$
declare v_now timestamptz:=clock_timestamp(); v_count integer;
begin
  perform private.require_control_lock(p_event_id);

  update attempts a
  set score = coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.points_awarded,0) end) from responses r where r.attempt_id=a.id),0)::int,
      valid_response_time_ms = coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.response_time_ms,0) end) from responses r where r.attempt_id=a.id),0)::bigint,
      status = 'timed_out'::attempt_status,
      submitted_at = coalesce(a.submitted_at,v_now),
      updated_at = v_now
  where a.event_id=p_event_id and a.round_id=p_round_id and a.status='active';

  update rounds set status='closed',closed_at=v_now where id=p_round_id and event_id=p_event_id;
  update questions q set status='used',used_at=coalesce(used_at,v_now) where q.id in(select question_id from round_questions where round_id=p_round_id) and q.status='approved';
  insert into audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(p_event_id,auth.uid(),p_round_id,'round','close','{}');
  select count(*) into v_count from attempts where round_id=p_round_id and status in ('completed','terminated','timed_out','recovered');
  return jsonb_build_object('round_id',p_round_id,'status','closed','attempts_closed',v_count);
end; $function$;

-- Repair previously finalized attempts whose stored aggregate score/time did not
-- match their saved responses (for example when Control Room closed the round
-- before the participant client called finish_quiz_attempt).
update attempts a
set score = coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.points_awarded,0) end) from responses r where r.attempt_id=a.id),0)::int,
    valid_response_time_ms = coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.response_time_ms,0) end) from responses r where r.attempt_id=a.id),0)::bigint,
    updated_at = clock_timestamp()
where a.status in ('completed','timed_out','terminated','recovered')
  and (a.score is distinct from coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.points_awarded,0) end) from responses r where r.attempt_id=a.id),0)::int
       or a.valid_response_time_ms is distinct from coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.response_time_ms,0) end) from responses r where r.attempt_id=a.id),0)::bigint);