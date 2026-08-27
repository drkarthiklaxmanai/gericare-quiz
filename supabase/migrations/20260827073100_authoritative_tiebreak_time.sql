-- Tie-break time is the server-measured elapsed duration of the round/final,
-- not the sum of cumulative per-question timestamps.
create or replace function public.finish_quiz_attempt(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v_a public.attempts; v_uid uuid:=auth.uid(); v_round_release timestamptz; v_score integer; v_time bigint; v_now timestamptz:=clock_timestamp();
begin
 select * into v_a from public.attempts where id=p_attempt for update;
 if v_a.id is null then raise exception 'attempt_not_found'; end if;
 if not exists(select 1 from public.event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_a.status<>'active' then return jsonb_build_object('attempt_id',v_a.id,'status',v_a.status,'score',v_a.score,'result_released_at',v_a.result_released_at); end if;
 select coalesce(sum(case when coalesce(is_void,false) then 0 else coalesce(points_awarded,0) end),0)::int into v_score from public.responses where attempt_id=p_attempt;
 v_time:=greatest(0,extract(epoch from (least(v_now,v_a.deadline_at)-v_a.started_at))*1000)::bigint;
 select r.results_released_at into v_round_release from public.rounds r where r.id=v_a.round_id;
 update public.attempts set status=case when v_now>=deadline_at then 'timed_out'::attempt_status else 'completed'::attempt_status end,submitted_at=v_now,score=v_score,valid_response_time_ms=v_time,result_released_at=v_round_release,updated_at=v_now where id=p_attempt returning * into v_a;
 insert into public.audit_events(event_id,participant_id,round_id,event_type,action,metadata) values(v_a.event_id,v_a.participant_id,v_a.round_id,'round','attempt_finished',jsonb_build_object('attempt_id',p_attempt,'score',v_a.score,'tiebreak_time_ms',v_a.valid_response_time_ms,'result_released_at',v_a.result_released_at));
 return jsonb_build_object('attempt_id',v_a.id,'status',v_a.status,'score',v_a.score,'response_time_ms',v_a.valid_response_time_ms,'result_released_at',v_a.result_released_at);
end;$function$;

create or replace function public.close_round(p_event_id uuid,p_round_id uuid)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v_now timestamptz:=clock_timestamp(); v_count integer;
begin
 perform private.require_control_lock(p_event_id);
 update public.attempts a set
   score=coalesce((select sum(case when coalesce(r.is_void,false) then 0 else coalesce(r.points_awarded,0) end) from public.responses r where r.attempt_id=a.id),0)::int,
   valid_response_time_ms=greatest(0,extract(epoch from (least(v_now,a.deadline_at)-a.started_at))*1000)::bigint,
   status='timed_out'::attempt_status,
   submitted_at=coalesce(a.submitted_at,v_now),updated_at=v_now
 where a.event_id=p_event_id and a.round_id=p_round_id and a.status='active';
 update public.rounds set status='closed',closed_at=v_now where id=p_round_id and event_id=p_event_id;
 update public.questions q set status='used',used_at=coalesce(used_at,v_now) where q.id in(select question_id from public.round_questions where round_id=p_round_id) and q.status='approved';
 insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(p_event_id,auth.uid(),p_round_id,'round','close','{}');
 select count(*) into v_count from public.attempts where round_id=p_round_id and status in ('completed','terminated','timed_out','recovered');
 return jsonb_build_object('round_id',p_round_id,'status','closed','attempts_closed',v_count);
end;$function$;

create or replace function public.finish_final(p_final_attempt uuid)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v_f final_attempts%rowtype; v_uid uuid:=auth.uid(); v_status attempt_status; v_score integer; v_time bigint; v_now timestamptz:=clock_timestamp();
begin
 select fa.* into v_f from final_attempts fa join finalists f on f.id=fa.finalist_id join event_participants ep on ep.id=f.participant_id where fa.id=p_final_attempt for update;
 if v_f.id is null then raise exception 'final_attempt_not_found'; end if;
 if not exists(select 1 from finalists f join event_participants ep on ep.id=f.participant_id where f.id=v_f.finalist_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_f.status<>'active' then return jsonb_build_object('status',v_f.status,'score',v_f.score); end if;
 select coalesce(sum(coalesce(points_awarded,0)),0)::int into v_score from final_responses where final_attempt_id=p_final_attempt;
 v_time:=greatest(0,extract(epoch from (least(v_now,v_f.deadline_at)-v_f.started_at))*1000)::bigint;
 v_status:=case when v_now>=v_f.deadline_at then 'timed_out'::attempt_status else 'completed'::attempt_status end;
 update final_attempts set status=v_status,submitted_at=v_now,score=v_score,valid_response_time_ms=v_time,updated_at=v_now where id=p_final_attempt returning * into v_f;
 update finalists set status='completed' where id=v_f.finalist_id;
 insert into audit_events(event_id,actor_user_id,event_type,action,metadata) select f.event_id,v_uid,'scoring','final_finished',jsonb_build_object('finalist_id',f.id,'score',v_f.score,'tiebreak_time_ms',v_f.valid_response_time_ms) from finalists f where f.id=v_f.finalist_id;
 return jsonb_build_object('status',v_f.status,'score',v_f.score,'response_time_ms',v_f.valid_response_time_ms);
end;$function$;

create or replace function public.record_integrity_event(p_attempt uuid,p_event integrity_event_type,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v_a public.attempts; v_count int; v_uid uuid:=auth.uid(); v_limit int; v_round_release timestamptz; v_score integer; v_time bigint; v_now timestamptz:=clock_timestamp();
begin
 select * into v_a from public.attempts where id=p_attempt for update;
 if v_a.id is null then raise exception 'attempt_not_found'; end if;
 if not exists(select 1 from public.event_participants ep where ep.id=v_a.participant_id and ep.user_id=v_uid) then raise exception 'forbidden'; end if;
 if v_a.status<>'active' or v_now>=v_a.deadline_at then return jsonb_build_object('ignored',true,'reason',case when v_a.status<>'active' then 'attempt_not_active' else 'attempt_expired' end,'warning_count',v_a.warning_count,'terminated',false); end if;
 insert into public.integrity_events(event_id,attempt_id,participant_id,event,metadata) values(v_a.event_id,v_a.id,v_a.participant_id,p_event,p_metadata);
 v_count:=v_a.warning_count+case when p_event in ('visibility_hidden','window_blur') then 1 else 0 end;
 v_limit:=(select coalesce((settings->>'visibility_warning_limit')::int,2) from public.events where id=v_a.event_id);
 if p_event in ('visibility_hidden','window_blur') and v_count>=v_limit then
   select coalesce(sum(case when coalesce(is_void,false) then 0 else coalesce(points_awarded,0) end),0)::int into v_score from public.responses where attempt_id=p_attempt;
   v_time:=greatest(0,extract(epoch from (least(v_now,v_a.deadline_at)-v_a.started_at))*1000)::bigint;
   select r.results_released_at into v_round_release from public.rounds r where r.id=v_a.round_id;
   update public.attempts set warning_count=v_count,status='terminated',submitted_at=coalesce(submitted_at,v_now),score=v_score,valid_response_time_ms=v_time,result_released_at=v_round_release,updated_at=v_now where id=v_a.id;
 else
   update public.attempts set warning_count=v_count,updated_at=v_now where id=v_a.id;
 end if;
 return jsonb_build_object('ignored',false,'warning_count',v_count,'warning_limit',v_limit,'terminated',v_count>=v_limit and p_event in ('visibility_hidden','window_blur'));
end;$function$;
