-- Allow admins to unlock a draft round's question set for re-organization.
create or replace function public.unlock_round_question_set(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event uuid;
  v_status text;
begin
  select event_id, status into v_event, v_status
  from public.rounds
  where id = p_round_id
  for update;

  if v_event is null then
    raise exception 'round_not_found';
  end if;

  if not private.is_event_admin(v_event) then
    raise exception 'forbidden';
  end if;

  -- Only unlock while still draft — never while open/closed/live ops
  if v_status is distinct from 'draft' then
    raise exception 'can_only_unlock_draft_rounds';
  end if;

  update public.rounds
  set questions_locked = false,
      updated_at = clock_timestamp()
  where id = p_round_id;

  insert into public.audit_events(event_id, actor_user_id, round_id, event_type, action, metadata)
  values (v_event, auth.uid(), p_round_id, 'round', 'question_set_unlocked', '{}'::jsonb);
end;
$$;

revoke all on function public.unlock_round_question_set(uuid) from public, anon;
grant execute on function public.unlock_round_question_set(uuid) to authenticated;
