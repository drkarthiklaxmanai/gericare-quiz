-- Server-authoritative quiz timers, configurable by super admins.
update public.events
set settings = coalesce(settings,'{}'::jsonb)
  || jsonb_build_object(
    'round_duration_seconds',90,
    'final_duration_seconds',coalesce((settings->>'final_duration_seconds')::int,600)
  ),
  updated_at=clock_timestamp();

create or replace function public.get_quiz_timers(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v_settings jsonb;
begin
 if auth.uid() is null or not exists(
   select 1 from public.event_admins where event_id=p_event_id and user_id=auth.uid() and role='super_admin'
 ) then raise exception 'forbidden'; end if;
 select coalesce(settings,'{}'::jsonb) into v_settings from public.events where id=p_event_id;
 if v_settings is null then raise exception 'event_not_found'; end if;
 return jsonb_build_object(
   'prelim_seconds',coalesce((v_settings->>'round_duration_seconds')::int,90),
   'final_seconds',coalesce((v_settings->>'final_duration_seconds')::int,600)
 );
end;$function$;

create or replace function public.set_quiz_timers(p_event_id uuid,p_prelim_seconds int,p_final_seconds int)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
begin
 if auth.uid() is null or not exists(
   select 1 from public.event_admins where event_id=p_event_id and user_id=auth.uid() and role='super_admin'
 ) then raise exception 'forbidden'; end if;
 if p_prelim_seconds < 30 or p_prelim_seconds > 900 then raise exception 'prelim_timer_out_of_range'; end if;
 if p_final_seconds < 60 or p_final_seconds > 3600 then raise exception 'final_timer_out_of_range'; end if;
 if exists(select 1 from public.attempts where event_id=p_event_id and status='active') then raise exception 'cannot_change_timer_during_active_round'; end if;
 if exists(select 1 from public.final_attempts fa join public.finalists f on f.id=fa.finalist_id where f.event_id=p_event_id and fa.status='active') then raise exception 'cannot_change_timer_during_active_final'; end if;
 update public.events
 set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('round_duration_seconds',p_prelim_seconds,'final_duration_seconds',p_final_seconds),updated_at=clock_timestamp()
 where id=p_event_id;
 if not found then raise exception 'event_not_found'; end if;
 insert into public.audit_events(event_id,actor_user_id,event_type,action,metadata)
 values(p_event_id,auth.uid(),'settings','timers_updated',jsonb_build_object('prelim_seconds',p_prelim_seconds,'final_seconds',p_final_seconds));
 return jsonb_build_object('ok',true,'prelim_seconds',p_prelim_seconds,'final_seconds',p_final_seconds);
end;$function$;

create or replace function public.start_final(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare f record; v_now timestamptz:=clock_timestamp(); v_questions uuid[]; v_final_count integer; v_duration int; v_deadline timestamptz;
begin
 perform private.require_control_lock(p_event_id);
 select coalesce((settings->>'final_duration_seconds')::int,600) into v_duration from public.events where id=p_event_id;
 v_deadline:=v_now+make_interval(secs=>v_duration);
 select array_agg(question_id order by canonical_order) into v_questions from final_questions where event_id=p_event_id;
 if coalesce(array_length(v_questions,1),0)<>10 then raise exception 'final requires exactly 10 explicitly selected questions'; end if;
 if exists(select 1 from questions q where q.id=any(v_questions) and q.status not in ('approved','used')) then raise exception 'all final questions must be approved'; end if;
 select count(*) into v_final_count from finalists where event_id=p_event_id;
 if v_final_count<>10 then raise exception 'exactly 10 finalists required'; end if;
 for f in select id from finalists where event_id=p_event_id loop
   insert into final_attempts(finalist_id,status,started_at,deadline_at,question_manifest)
   values(f.id,'active',v_now,v_deadline,jsonb_build_object('question_ids',to_jsonb(v_questions)))
   on conflict(finalist_id) do update
   set status='active',started_at=v_now,submitted_at=null,score=0,valid_response_time_ms=0,deadline_at=v_deadline,question_manifest=excluded.question_manifest;
 end loop;
 update finalists set status='active',verified_at=coalesce(verified_at,v_now) where event_id=p_event_id;
 insert into audit_events(event_id,actor_user_id,event_type,action,metadata)
 values(p_event_id,auth.uid(),'round','start_final',jsonb_build_object('questions',v_questions,'duration_seconds',v_duration));
 return jsonb_build_object('started_at',v_now,'deadline_at',v_deadline,'duration_seconds',v_duration,'question_ids',to_jsonb(v_questions));
end;$function$;
