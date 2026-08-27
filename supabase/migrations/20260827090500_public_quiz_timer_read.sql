-- Quiz timer values are non-sensitive and must be readable by participant/projector clients.
-- Keep writes restricted to super_admin via set_quiz_timers().
create or replace function public.get_quiz_timers(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare v_settings jsonb;
begin
  select coalesce(settings,'{}'::jsonb)
    into v_settings
  from public.events
  where id=p_event_id;

  if v_settings is null then
    raise exception 'event_not_found';
  end if;

  return jsonb_build_object(
    'prelim_seconds',coalesce((v_settings->>'round_duration_seconds')::int,90),
    'final_seconds',coalesce((v_settings->>'final_duration_seconds')::int,600)
  );
end;
$function$;

grant execute on function public.get_quiz_timers(uuid) to anon, authenticated;
