create or replace function public.submit_quiz_response(p_attempt uuid, p_question uuid, p_option text, p_client_ms bigint default null)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $function$
declare v_a attempts%rowtype; v_uid uuid:=auth.uid(); v_q questions%rowtype; v_correct boolean; v_award integer; v_wrong_points integer; v_started timestamptz; v_submitted timestamptz:=clock_timestamp(); v_time bigint; v_pos smallint;
begin
 select * into v_a from attempts where id=p_attempt for update;
 if v_a.id is null then raise exception 'attempt_not_found'; end if;
 if not exists(select 1 from event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_a.status<>'active' then raise exception 'attempt_not_active'; end if;
 if v_submitted>v_a.deadline_at then raise exception 'attempt_expired'; end if;
 if p_option not in ('A','B','C','D') then raise exception 'invalid_option'; end if;
 select (x->>'position')::smallint into v_pos from jsonb_array_elements(v_a.question_manifest) x where x->>'question_id'=p_question::text;
 if v_pos is null then raise exception 'question_not_in_attempt'; end if;
 select * into v_q from questions where id=p_question;
 if v_q.id is null then raise exception 'question_not_found'; end if;
 select is_correct into v_correct from question_options where question_id=p_question and option_key=p_option;
 if v_correct is null then raise exception 'option_not_found'; end if;
 select coalesce((e.settings->>'wrong_answer_points')::int,-5) into v_wrong_points from events e where e.id=v_a.event_id;
 v_award:=case when v_correct then v_q.points else v_wrong_points end;
 select question_started_at into v_started from responses where attempt_id=p_attempt and question_id=p_question for update;
 if v_started is null then v_started:=v_a.started_at; end if;
 v_time:=greatest(0,extract(epoch from (v_submitted-v_started))*1000)::bigint;
 update responses set selected_option_key=p_option,submitted_at=v_submitted,response_time_ms=v_time,is_correct=v_correct,points_awarded=v_award where attempt_id=p_attempt and question_id=p_question;
 if not found then insert into responses(attempt_id,question_id,displayed_position,selected_option_key,question_started_at,submitted_at,response_time_ms,is_correct,points_awarded) values(p_attempt,p_question,v_pos,p_option,v_started,v_submitted,v_time,v_correct,v_award); end if;
 update attempts set updated_at=clock_timestamp() where id=p_attempt;
 insert into audit_events(event_id,participant_id,round_id,event_type,action,metadata) values(v_a.event_id,v_a.participant_id,v_a.round_id,'response','answer_saved',jsonb_build_object('attempt_id',p_attempt,'question_id',p_question,'points_if_final',v_award));
 return jsonb_build_object('accepted',true,'is_correct',v_correct,'points_if_final',v_award,'submitted_at',v_submitted,'response_time_ms',v_time);
end;$function$;

create or replace function public.finish_quiz_attempt(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $function$
declare v_a public.attempts; v_uid uuid:=auth.uid(); v_round_release timestamptz; v_score integer; v_time bigint;
begin
 select * into v_a from public.attempts where id=p_attempt for update;
 if v_a.id is null then raise exception 'attempt_not_found'; end if;
 if not exists(select 1 from public.event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_a.status<>'active' then return jsonb_build_object('attempt_id',v_a.id,'status',v_a.status,'score',v_a.score,'result_released_at',v_a.result_released_at); end if;
 select coalesce(sum(case when coalesce(is_void,false) then 0 else coalesce(points_awarded,0) end),0)::int, coalesce(sum(case when coalesce(is_void,false) then 0 else coalesce(response_time_ms,0) end),0)::bigint into v_score,v_time from public.responses where attempt_id=p_attempt;
 select r.results_released_at into v_round_release from public.rounds r where r.id=v_a.round_id;
 update public.attempts set status=case when clock_timestamp()>=deadline_at then 'timed_out'::attempt_status else 'completed'::attempt_status end,submitted_at=clock_timestamp(),score=v_score,valid_response_time_ms=v_time,result_released_at=v_round_release,updated_at=clock_timestamp() where id=p_attempt returning * into v_a;
 insert into public.audit_events(event_id,participant_id,round_id,event_type,action,metadata) values(v_a.event_id,v_a.participant_id,v_a.round_id,'round','attempt_finished',jsonb_build_object('attempt_id',p_attempt,'score',v_a.score,'result_released_at',v_a.result_released_at));
 return jsonb_build_object('attempt_id',v_a.id,'status',v_a.status,'score',v_a.score,'result_released_at',v_a.result_released_at);
end;$function$;

create or replace function public.submit_final_response(p_final_attempt uuid, p_question uuid, p_option text)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $function$
declare v_f final_attempts%rowtype; v_uid uuid:=auth.uid(); v_correct boolean; v_award integer; v_wrong_points integer; v_event_id uuid; v_started timestamptz; v_submitted timestamptz:=clock_timestamp(); v_time bigint; v_pos smallint;
begin
 select fa.* into v_f from final_attempts fa join finalists f on f.id=fa.finalist_id join event_participants ep on ep.id=f.participant_id where fa.id=p_final_attempt for update;
 if v_f.id is null then raise exception 'final_attempt_not_found'; end if;
 select f.event_id into v_event_id from finalists f where f.id=v_f.finalist_id;
 if not exists(select 1 from finalists f join event_participants ep on ep.id=f.participant_id where f.id=v_f.finalist_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_f.status<>'active' or v_submitted>v_f.deadline_at then raise exception 'final_expired'; end if;
 if p_option not in ('A','B','C','D') then raise exception 'invalid_option'; end if;
 select ord into v_pos from (select row_number() over(order by x.ordinal) ord,x.id from jsonb_array_elements_text(v_f.question_manifest->'question_ids') with ordinality x(id,ordinal)) s where s.id=p_question::text;
 if v_pos is null then raise exception 'question_not_in_final'; end if;
 select is_correct into v_correct from question_options where question_id=p_question and option_key=p_option;
 if v_correct is null then raise exception 'option_not_found'; end if;
 select coalesce((settings->>'wrong_answer_points')::int,-5) into v_wrong_points from events where id=v_event_id;
 v_award:=case when v_correct then 10 else v_wrong_points end;
 select question_started_at into v_started from final_responses where final_attempt_id=p_final_attempt and question_id=p_question for update;
 if v_started is null then v_started:=v_f.started_at; end if;
 v_time:=greatest(0,extract(epoch from(v_submitted-v_started))*1000)::bigint;
 update final_responses set selected_option_key=p_option,submitted_at=v_submitted,response_time_ms=v_time,is_correct=v_correct,points_awarded=v_award where final_attempt_id=p_final_attempt and question_id=p_question;
 if not found then insert into final_responses(final_attempt_id,question_id,displayed_position,selected_option_key,question_started_at,submitted_at,response_time_ms,is_correct,points_awarded) values(p_final_attempt,p_question,v_pos,p_option,v_started,v_submitted,v_time,v_correct,v_award); end if;
 update final_attempts set updated_at=clock_timestamp() where id=p_final_attempt;
 return jsonb_build_object('accepted',true,'is_correct',v_correct,'points_if_final',v_award,'response_time_ms',v_time);
end;$function$;

create or replace function public.finish_final(p_final_attempt uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $function$
declare v_f final_attempts%rowtype; v_uid uuid:=auth.uid(); v_status attempt_status; v_score integer; v_time bigint;
begin
 select fa.* into v_f from final_attempts fa join finalists f on f.id=fa.finalist_id join event_participants ep on ep.id=f.participant_id where fa.id=p_final_attempt for update;
 if v_f.id is null then raise exception 'final_attempt_not_found'; end if;
 if not exists(select 1 from finalists f join event_participants ep on ep.id=f.participant_id where f.id=v_f.finalist_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_f.status<>'active' then return jsonb_build_object('status',v_f.status,'score',v_f.score); end if;
 select coalesce(sum(coalesce(points_awarded,0)),0)::int,coalesce(sum(coalesce(response_time_ms,0)),0)::bigint into v_score,v_time from final_responses where final_attempt_id=p_final_attempt;
 v_status:=case when clock_timestamp()>=v_f.deadline_at then 'timed_out'::attempt_status else 'completed'::attempt_status end;
 update final_attempts set status=v_status,submitted_at=clock_timestamp(),score=v_score,valid_response_time_ms=v_time,updated_at=clock_timestamp() where id=p_final_attempt returning * into v_f;
 update finalists set status='completed' where id=v_f.finalist_id;
 insert into audit_events(event_id,actor_user_id,event_type,action,metadata) select f.event_id,v_uid,'scoring','final_finished',jsonb_build_object('finalist_id',f.id,'score',v_f.score) from finalists f where f.id=v_f.finalist_id;
 return jsonb_build_object('status',v_f.status,'score',v_f.score,'response_time_ms',v_f.valid_response_time_ms);
end;$function$;