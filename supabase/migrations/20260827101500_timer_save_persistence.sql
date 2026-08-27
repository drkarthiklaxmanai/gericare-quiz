-- Timer changes are configuration for future attempts. Existing attempts keep their own deadline_at,
-- so changing the configured duration is safe even while an attempt is active.
create or replace function public.set_quiz_timers(
  p_event_id uuid,
  p_prelim_seconds int,
  p_final_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
begin
  if auth.uid() is null or not exists(
    select 1
    from public.event_admins
    where event_id=p_event_id
      and user_id=auth.uid()
      and role='super_admin'
  ) then
    raise exception 'forbidden';
  end if;

  if p_prelim_seconds < 30 or p_prelim_seconds > 900 then
    raise exception 'prelim_timer_out_of_range';
  end if;
  if p_final_seconds < 60 or p_final_seconds > 3600 then
    raise exception 'final_timer_out_of_range';
  end if;

  update public.events
  set settings = coalesce(settings,'{}'::jsonb)
      || jsonb_build_object(
        'round_duration_seconds',p_prelim_seconds,
        'final_duration_seconds',p_final_seconds
      ),
      updated_at = clock_timestamp()
  where id=p_event_id;

  if not found then
    raise exception 'event_not_found';
  end if;

  -- Audit failure must never roll back the actual timer setting.
  begin
    insert into public.audit_events(event_id,actor_user_id,event_type,action,metadata)
    values(
      p_event_id,
      auth.uid(),
      'settings',
      'timers_updated',
      jsonb_build_object('prelim_seconds',p_prelim_seconds,'final_seconds',p_final_seconds)
    );
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok',true,
    'prelim_seconds',p_prelim_seconds,
    'final_seconds',p_final_seconds
  );
end;
$function$;

grant execute on function public.set_quiz_timers(uuid,int,int) to authenticated;
