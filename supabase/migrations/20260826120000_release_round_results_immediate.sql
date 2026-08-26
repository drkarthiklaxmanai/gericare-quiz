-- Ensure release_round_results immediately unlocks participant results
-- (sets attempts.result_released_at = now(), not a future delay)

create or replace function public.release_round_results(p_event_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_n int := 0;
  v_round public.rounds%rowtype;
begin
  if auth.uid() is null or not private.is_event_admin(p_event_id) then
    raise exception 'forbidden';
  end if;

  select * into v_round from public.rounds where id = p_round_id and event_id = p_event_id for update;
  if not found then
    raise exception 'round_not_found';
  end if;
  if v_round.status not in ('closed', 'open') then
    raise exception 'round_must_be_open_or_closed_to_release';
  end if;

  -- Close if still open
  if v_round.status = 'open' then
    update public.rounds
    set status = 'closed',
        closed_at = coalesce(closed_at, clock_timestamp())
    where id = p_round_id;
  end if;

  -- Immediate release for all attempts in this round
  update public.attempts
  set result_released_at = clock_timestamp()
  where event_id = p_event_id
    and round_id = p_round_id
    and (result_released_at is null or result_released_at > clock_timestamp());

  get diagnostics v_n = row_count;

  insert into public.audit_events(event_id, actor_user_id, event_type, action, metadata)
  values (
    p_event_id,
    auth.uid(),
    'round',
    'release_round_results',
    jsonb_build_object('round_id', p_round_id, 'attempts_released', v_n)
  );

  return jsonb_build_object('ok', true, 'attempts_released', v_n, 'round_id', p_round_id);
end;
$$;

revoke all on function public.release_round_results(uuid, uuid) from public;
grant execute on function public.release_round_results(uuid, uuid) to authenticated;
