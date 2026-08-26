-- Image-question support for the projector review flow.
-- Participant delivery uses short-lived signed URLs from quiz-api.
-- Projector delivery uses a presentation-state-gated media proxy, so the private bucket stays private.

create or replace function public.publish_presentation_state(
  p_event_id uuid,
  p_state text,
  p_round_id uuid default null,
  p_title text default null,
  p_question text default null,
  p_options jsonb default '[]'::jsonb,
  p_answer text default null,
  p_explanation text default null,
  p_top10 jsonb default '[]'::jsonb,
  p_media jsonb default '[]'::jsonb
) returns public.presentation_state
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_row public.presentation_state%rowtype;
  v_round integer;
  v_media jsonb:=coalesce(p_media,'[]'::jsonb);
begin
 if auth.uid() is null or not private.is_event_admin(p_event_id) then raise exception 'Forbidden'; end if;
 if p_state not in ('WAITING','RULES','QUESTION','ANSWER_REVEAL','EXPLANATION','ROUND_TOP10','LEADERBOARD','FINAL','WINNER') then raise exception 'Invalid presentation state'; end if;
 if p_round_id is not null then select round_number into v_round from public.rounds where id=p_round_id and event_id=p_event_id; end if;

 -- Control Room already sends the exact question stem on recap. If it did not
 -- explicitly provide media, attach that question's still images automatically.
 if jsonb_array_length(v_media)=0 and p_state in ('QUESTION','ANSWER_REVEAL','EXPLANATION') and p_question is not null then
   select coalesce(jsonb_agg(jsonb_build_object(
     'id',qm.id,
     'storage_path',qm.storage_path,
     'mime_type',qm.mime_type,
     'alt',coalesce(qm.metadata->>'alt',qm.metadata->>'original_name','Question image')
   ) order by qm.sort_order,qm.created_at),'[]'::jsonb)
   into v_media
   from public.questions q
   join public.question_media qm on qm.question_id=q.id and qm.media_type='image'
   where q.event_id=p_event_id and q.stem=p_question;
 end if;

 insert into public.presentation_state(event_id,state,round_id,round_number,title,question,options,answer,explanation,top10,media,updated_by,updated_at)
 values(p_event_id,p_state,p_round_id,v_round,p_title,p_question,coalesce(p_options,'[]'::jsonb),p_answer,p_explanation,coalesce(p_top10,'[]'::jsonb),v_media,auth.uid(),now())
 on conflict(event_id) do update set state=excluded.state,round_id=excluded.round_id,round_number=excluded.round_number,title=excluded.title,question=excluded.question,options=excluded.options,answer=excluded.answer,explanation=excluded.explanation,top10=excluded.top10,media=excluded.media,updated_by=excluded.updated_by,updated_at=excluded.updated_at
 returning * into v_row;
 insert into public.audit_events(event_id,actor_user_id,round_id,event_type,action,metadata) values(p_event_id,auth.uid(),p_round_id,'projector','presentation_state_published',jsonb_build_object('state',p_state,'media_count',jsonb_array_length(v_media)));
 return v_row;
end;$$;

revoke all on function public.publish_presentation_state(uuid,text,uuid,text,text,jsonb,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.publish_presentation_state(uuid,text,uuid,text,text,jsonb,text,text,jsonb,jsonb) to authenticated;
