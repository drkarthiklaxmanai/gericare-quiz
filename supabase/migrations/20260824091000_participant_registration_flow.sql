create or replace function public.register_for_event(p_event_id uuid, p_display_name text)
returns public.event_participants
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_existing public.event_participants%rowtype;
  v_result public.event_participants%rowtype;
  v_count integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_display_name),'') is null then raise exception 'Display name required'; end if;
  select * into v_existing from public.event_participants where event_id=p_event_id and user_id=v_user;
  if found then return v_existing; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not v_event.registration_open or v_event.status not in ('registration_open','live') then raise exception 'Registration is closed'; end if;
  select count(*) into v_count from public.event_participants where event_id=p_event_id;
  if v_count >= v_event.max_participants then raise exception 'Event registration is full'; end if;
  insert into public.profiles(id,full_name,display_name,email)
  values(v_user,btrim(p_display_name),btrim(p_display_name),(select email from auth.users where id=v_user))
  on conflict(id) do update set display_name=excluded.display_name, full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name), updated_at=now();
  insert into public.event_participants(event_id,user_id,display_name) values(p_event_id,v_user,btrim(p_display_name)) returning * into v_result;
  insert into public.audit_events(event_id,actor_user_id,participant_id,event_type,action,metadata)
  values(p_event_id,v_user,v_result.id,'registration','participant_registered',jsonb_build_object('display_name',btrim(p_display_name)));
  return v_result;
end;$$;
revoke all on function public.register_for_event(uuid,text) from public, anon;
grant execute on function public.register_for_event(uuid,text) to authenticated;
