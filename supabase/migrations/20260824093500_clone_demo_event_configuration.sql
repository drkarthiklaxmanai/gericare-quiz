create or replace function public.clone_demo_event_configuration(p_source_event uuid,p_name text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_demo uuid; v_q record; v_new_q uuid; v_r record; v_new_r uuid; v_cat record; v_new_cat uuid;
begin
 if auth.uid() is null or not private.is_event_admin(p_source_event) then raise exception 'Forbidden'; end if;
 if not exists(select 1 from public.events where id=p_source_event and is_demo=false) then raise exception 'Source event not found'; end if;
 insert into public.events(name,slug,status,max_participants,registration_open,branding,settings,retention_days,is_demo)
 select coalesce(nullif(trim(p_name),''),name||' — Rehearsal'),slug||'-demo-'||substr(gen_random_uuid()::text,1,8),'draft',max_participants,false,branding,settings||jsonb_build_object('result_release_delay_seconds',0),retention_days,true from public.events where id=p_source_event returning id into v_demo;
 insert into public.event_admins(event_id,user_id,role) select v_demo,user_id,role from public.event_admins where event_id=p_source_event;
 create temporary table tmp_cat_map(old_id uuid primary key,new_id uuid) on commit drop;
 create temporary table tmp_q_map(old_id uuid primary key,new_id uuid) on commit drop;
 create temporary table tmp_r_map(old_id uuid primary key,new_id uuid) on commit drop;
 for v_cat in select * from public.categories where event_id=p_source_event loop insert into public.categories(event_id,name,slug) values(v_demo,v_cat.name,v_cat.slug) returning id into v_new_cat; insert into tmp_cat_map values(v_cat.id,v_new_cat); end loop;
 for v_q in select * from public.questions where event_id=p_source_event and status in ('approved','used') loop
   insert into public.questions(event_id,category_id,stem,type,difficulty,explanation,reference_text,points,status,tags,ai_metadata,approved_by,approved_at,created_by)
   values(v_demo,(select new_id from tmp_cat_map where old_id=v_q.category_id),v_q.stem,v_q.type,v_q.difficulty,v_q.explanation,v_q.reference_text,v_q.points,'approved',v_q.tags,v_q.ai_metadata,v_q.approved_by,v_q.approved_at,v_q.created_by) returning id into v_new_q;
   insert into tmp_q_map values(v_q.id,v_new_q);
   insert into public.question_options(question_id,option_key,option_text,is_correct,explanation) select v_new_q,option_key,option_text,is_correct,explanation from public.question_options where question_id=v_q.id;
 end loop;
 for v_r in select * from public.rounds where event_id=p_source_event order by round_number loop insert into public.rounds(event_id,round_number,title,status,is_optional,questions_locked) values(v_demo,v_r.round_number,v_r.title,'draft',v_r.is_optional,v_r.questions_locked) returning id into v_new_r; insert into tmp_r_map values(v_r.id,v_new_r); end loop;
 insert into public.round_questions(round_id,question_id,canonical_order) select rm.new_id,qm.new_id,rq.canonical_order from public.round_questions rq join tmp_r_map rm on rm.old_id=rq.round_id join tmp_q_map qm on qm.old_id=rq.question_id;
 insert into public.final_questions(event_id,question_id,canonical_order) select v_demo,qm.new_id,fq.canonical_order from public.final_questions fq join tmp_q_map qm on qm.old_id=fq.question_id where fq.event_id=p_source_event;
 insert into public.audit_events(event_id,actor_user_id,event_type,action,metadata) values(v_demo,auth.uid(),'demo','demo_event_cloned',jsonb_build_object('source_event_id',p_source_event));
 return v_demo;
end;$$;
revoke all on function public.clone_demo_event_configuration(uuid,text) from public,anon;
grant execute on function public.clone_demo_event_configuration(uuid,text) to authenticated;
