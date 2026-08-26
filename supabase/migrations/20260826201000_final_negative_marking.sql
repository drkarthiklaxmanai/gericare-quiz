-- Apply the same configurable wrong-answer penalty to the Grand Final.

create or replace function public.submit_final_response(
  p_final_attempt uuid,
  p_question uuid,
  p_option text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_f final_attempts%rowtype;
  v_uid uuid := auth.uid();
  v_correct boolean;
  v_award integer;
  v_wrong_points integer;
  v_event_id uuid;
  v_started timestamptz;
  v_submitted timestamptz := clock_timestamp();
  v_time bigint;
  v_pos smallint;
begin
  select fa.*, f.event_id
  into v_f, v_event_id
  from final_attempts fa
  join finalists f on f.id=fa.finalist_id
  join event_participants ep on ep.id=f.participant_id
  where fa.id=p_final_attempt
  for update;

  if v_f.id is null then raise exception 'final_attempt_not_found'; end if;
  if not exists(select 1 from finalists f join event_participants ep on ep.id=f.participant_id where f.id=v_f.finalist_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
  if v_f.status<>'active' or v_submitted>v_f.deadline_at then raise exception 'final_expired'; end if;
  if p_option not in ('A','B','C','D') then raise exception 'invalid_option'; end if;

  select ord into v_pos
  from (
    select row_number() over(order by x.ordinal) ord,x.id
    from jsonb_array_elements_text(v_f.question_manifest->'question_ids') with ordinality x(id,ordinal)
  ) s where s.id=p_question::text;
  if v_pos is null then raise exception 'question_not_in_final'; end if;

  select is_correct into v_correct from question_options where question_id=p_question and option_key=p_option;
  if v_correct is null then raise exception 'option_not_found'; end if;

  select coalesce((settings->>'wrong_answer_points')::int,-5)
  into v_wrong_points from events where id=v_event_id;
  v_award := case when v_correct then 10 else v_wrong_points end;

  select question_started_at into v_started from final_responses where final_attempt_id=p_final_attempt and question_id=p_question for update;
  if v_started is null then v_started:=v_f.started_at; end if;
  if exists(select 1 from final_responses where final_attempt_id=p_final_attempt and question_id=p_question and submitted_at is not null) then raise exception 'response_already_submitted'; end if;

  v_time:=greatest(0,extract(epoch from(v_submitted-v_started))*1000)::bigint;
  update final_responses set selected_option_key=p_option,submitted_at=v_submitted,response_time_ms=v_time,is_correct=v_correct,points_awarded=v_award where final_attempt_id=p_final_attempt and question_id=p_question;
  if not found then insert into final_responses(final_attempt_id,question_id,displayed_position,selected_option_key,question_started_at,submitted_at,response_time_ms,is_correct,points_awarded) values(p_final_attempt,p_question,v_pos,p_option,v_started,v_submitted,v_time,v_correct,v_award); end if;

  update final_attempts set score=score+v_award,valid_response_time_ms=valid_response_time_ms+v_time,updated_at=clock_timestamp() where id=p_final_attempt;
  return jsonb_build_object('accepted',true,'is_correct',v_correct,'points',v_award,'response_time_ms',v_time);
end;
$function$;
