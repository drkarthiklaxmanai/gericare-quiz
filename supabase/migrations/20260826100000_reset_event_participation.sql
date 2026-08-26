-- Admin-only: wipe live participation/scores so the same event can be re-run.
-- Keeps: questions, options, categories, round_questions, final_questions, event_participants (roster).
-- Clears: attempts, responses, integrity, leaderboards, finalists, sudden death, presentation state.
-- Resets: rounds to draft (keeps questions_locked), event status toward live.

create or replace function public.reset_event_participation(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts int := 0;
  v_responses int := 0;
  v_integrity int := 0;
  v_snaps int := 0;
  v_finalists int := 0;
  v_rounds int := 0;
begin
  if auth.uid() is null or not private.is_event_admin(p_event_id) then
    raise exception 'forbidden';
  end if;

  -- responses first (FK to attempts)
  if to_regclass('public.responses') is not null then
    delete from public.responses r
    using public.attempts a
    where r.attempt_id = a.id and a.event_id = p_event_id;
    get diagnostics v_responses = row_count;
  end if;

  if to_regclass('public.attempts') is not null then
    delete from public.attempts where event_id = p_event_id;
    get diagnostics v_attempts = row_count;
  end if;

  if to_regclass('public.integrity_events') is not null then
    delete from public.integrity_events where event_id = p_event_id;
    get diagnostics v_integrity = row_count;
  end if;

  if to_regclass('public.leaderboard_snapshots') is not null then
    delete from public.leaderboard_snapshots where event_id = p_event_id;
    get diagnostics v_snaps = row_count;
  end if;

  if to_regclass('public.finalists') is not null then
    delete from public.finalists where event_id = p_event_id;
    get diagnostics v_finalists = row_count;
  end if;

  -- sudden death tables (best-effort names)
  if to_regclass('public.sudden_death_responses') is not null then
    execute 'delete from public.sudden_death_responses sdr using public.sudden_death_attempts sda where sdr.sudden_death_id = sda.id and sda.event_id = $1' using p_event_id;
  end if;
  if to_regclass('public.sudden_death_attempts') is not null then
    delete from public.sudden_death_attempts where event_id = p_event_id;
  end if;

  if to_regclass('public.presentation_state') is not null then
    -- schema may be global or event-scoped
    begin
      delete from public.presentation_state where event_id = p_event_id;
    exception when undefined_column then
      delete from public.presentation_state;
    end;
  end if;

  -- rounds back to draft; clear open/close timestamps if present
  update public.rounds
  set status = 'draft',
      opened_at = null,
      closed_at = null
  where event_id = p_event_id;
  get diagnostics v_rounds = row_count;

  -- reopen event if it was completed / final
  begin
    update public.events
    set status = case
      when status in ('completed','archived','final') then 'live'
      else status
    end
    where id = p_event_id;
  exception when others then
    null;
  end;

  insert into public.audit_events(event_id, actor_user_id, event_type, action, metadata)
  values (
    p_event_id,
    auth.uid(),
    'event',
    'reset_event_participation',
    jsonb_build_object(
      'attempts_deleted', v_attempts,
      'responses_deleted', v_responses,
      'integrity_deleted', v_integrity,
      'snapshots_deleted', v_snaps,
      'finalists_deleted', v_finalists,
      'rounds_reset', v_rounds
    )
  );

  return jsonb_build_object(
    'ok', true,
    'attempts_deleted', v_attempts,
    'responses_deleted', v_responses,
    'integrity_deleted', v_integrity,
    'snapshots_deleted', v_snaps,
    'finalists_deleted', v_finalists,
    'rounds_reset', v_rounds
  );
end;
$$;

revoke all on function public.reset_event_participation(uuid) from public;
grant execute on function public.reset_event_participation(uuid) to authenticated;
