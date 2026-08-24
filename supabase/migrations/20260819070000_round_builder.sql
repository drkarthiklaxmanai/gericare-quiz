create or replace function public.assign_question_to_round(p_round_id uuid,p_question_id uuid,p_canonical_order smallint)
returns void
language plpgsql
security definer
set search_path='public','private'
as $$
declare v_event uuid; v_locked boolean;
begin
 select event_id, questions_locked into v_event, v_locked from public.rounds where id=p_round_id for update;
 if v_event is null then raise exception 'round_not_found'; end if;
 if not private.is_event_admin(v_event) then raise exception 'forbidden'; end if;
 if v_locked then raise exception 'round_questions_locked'; end if;
 if p_canonical_order not between 1 and 3 then raise exception 'invalid_canonical_order'; end if;
 if not exists(select 1 from public.questions q where q.id=p_question_id and q.event_id=v_event and q.status='approved') then raise exception 'question_not_approved_for_event'; end if;
 if exists(select 1 from public.round_questions rq where rq.round_id=p_round_id and rq.question_id=p_question_id) then raise exception 'question_already_in_round'; end if;
 if exists(select 1 from public.round_questions rq join public.rounds r on r.id=rq.round_id where rq.question_id=p_question_id and r.event_id=v_event) then raise exception 'question_already_reserved_in_event'; end if;
 if exists(select 1 from public.round_questions where round_id=p_round_id and canonical_order=p_canonical_order) then raise exception 'canonical_order_in_use'; end if;
 if (select count(*) from public.round_questions where round_id=p_round_id)>=3 then raise exception 'round_full'; end if;
 insert into public.round_questions(round_id,question_id,canonical_order) values(p_round_id,p_question_id,p_canonical_order);
 insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(v_event,auth.uid(),p_round_id,'question','question_assigned',jsonb_build_object('question_id',p_question_id,'canonical_order',p_canonical_order));
end;$$;

create or replace function public.remove_question_from_round(p_round_id uuid,p_question_id uuid)
returns void
language plpgsql
security definer
set search_path='public','private'
as $$
declare v_event uuid; v_locked boolean;
begin
 select event_id, questions_locked into v_event, v_locked from public.rounds where id=p_round_id for update;
 if v_event is null then raise exception 'round_not_found'; end if;
 if not private.is_event_admin(v_event) then raise exception 'forbidden'; end if;
 if v_locked then raise exception 'round_questions_locked'; end if;
 delete from public.round_questions where round_id=p_round_id and question_id=p_question_id;
 if not found then raise exception 'assignment_not_found'; end if;
 insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(v_event,auth.uid(),p_round_id,'question','question_removed',jsonb_build_object('question_id',p_question_id));
end;$$;

create or replace function public.lock_round_question_set(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path='public','private'
as $$
declare v_event uuid; n int;
begin
 select event_id into v_event from public.rounds where id=p_round_id for update;
 if v_event is null then raise exception 'round_not_found'; end if;
 if not private.is_event_admin(v_event) then raise exception 'forbidden'; end if;
 select count(*) into n from public.round_questions where round_id=p_round_id;
 if n<>3 then raise exception 'exactly_three_questions_required'; end if;
 update public.rounds set questions_locked=true, updated_at=clock_timestamp() where id=p_round_id;
 insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(v_event,auth.uid(),p_round_id,'round','question_set_locked',jsonb_build_object('question_count',n));
end;$$;

revoke all on function public.assign_question_to_round(uuid,uuid,smallint) from public,anon;
revoke all on function public.remove_question_from_round(uuid,uuid) from public,anon;
revoke all on function public.lock_round_question_set(uuid) from public,anon;
grant execute on function public.assign_question_to_round(uuid,uuid,smallint) to authenticated;
grant execute on function public.remove_question_from_round(uuid,uuid) to authenticated;
grant execute on function public.lock_round_question_set(uuid) to authenticated;
