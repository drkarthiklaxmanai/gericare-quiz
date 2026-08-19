create or replace function public.assign_question_to_round(p_round_id uuid,p_question_id uuid,p_question_order integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_question_order not between 1 and 3 then raise exception 'A round can contain exactly 3 questions'; end if;
 if not exists(select 1 from questions where id=p_question_id and status='approved') then raise exception 'Only approved questions may be assigned'; end if;
 if exists(select 1 from rounds where id=p_round_id and status not in ('draft','scheduled')) then raise exception 'Round is locked'; end if;
 if exists(select 1 from round_questions where round_id=p_round_id and question_id=p_question_id) then raise exception 'Question already assigned to this round'; end if;
 if exists(select 1 from round_questions rq join rounds r on r.id=rq.round_id where rq.question_id=p_question_id and r.event_id=(select event_id from rounds where id=p_round_id)) then raise exception 'Question already used in this event'; end if;
 if (select count(*) from round_questions where round_id=p_round_id)>=3 then raise exception 'Round already has 3 questions'; end if;
 insert into round_questions(round_id,question_id,question_order) values(p_round_id,p_question_id,p_question_order);
end;$$;

create or replace function public.remove_question_from_round(p_round_id uuid,p_question_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from rounds where id=p_round_id and status not in ('draft','scheduled')) then raise exception 'Round is locked'; end if;
 delete from round_questions where round_id=p_round_id and question_id=p_question_id;
end;$$;

create or replace function public.lock_round_question_set(p_round_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 select count(*) into n from round_questions where round_id=p_round_id;
 if n<>3 then raise exception 'Exactly 3 questions are required before locking'; end if;
 if exists(select 1 from rounds where id=p_round_id and status not in ('draft','scheduled')) then raise exception 'Round cannot be locked in its current state'; end if;
 update rounds set status='locked' where id=p_round_id;
end;$$;

revoke all on function public.assign_question_to_round(uuid,uuid,integer) from public,anon;
revoke all on function public.remove_question_from_round(uuid,uuid) from public,anon;
revoke all on function public.lock_round_question_set(uuid) from public,anon;
grant execute on function public.assign_question_to_round(uuid,uuid,integer) to authenticated;
grant execute on function public.remove_question_from_round(uuid,uuid) to authenticated;
grant execute on function public.lock_round_question_set(uuid) to authenticated;
