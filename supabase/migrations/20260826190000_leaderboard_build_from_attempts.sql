-- Reliable leaderboard builders from attempts

create or replace function public.build_round_top10(p_event_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_has_round boolean;
begin
  if auth.uid() is null or not private.is_event_admin(p_event_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank), '[]'::jsonb)
  into v_rows
  from (
    select
      row_number() over (order by coalesce(a.score, 0) desc, a.submitted_at asc nulls last)::int as rank,
      a.participant_id,
      coalesce(nullif(trim(ep.display_name), ''), 'Participant') as display_name,
      coalesce(a.score, 0)::numeric as score,
      coalesce(a.score, 0)::numeric as round_score,
      (
        select coalesce(sum(a2.score), 0)::numeric
        from public.attempts a2
        where a2.event_id = p_event_id
          and a2.participant_id = a.participant_id
          and a2.status in ('completed', 'timed_out', 'recovered', 'terminated')
      ) as total_score
    from public.attempts a
    join public.event_participants ep on ep.id = a.participant_id
    where a.event_id = p_event_id
      and a.round_id = p_round_id
      and a.status in ('completed', 'timed_out', 'recovered', 'terminated')
  ) t;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leaderboard_snapshots' and column_name = 'round_id'
  ) into v_has_round;

  if v_has_round then
    insert into public.leaderboard_snapshots(event_id, round_id, snapshot_type, payload)
    values (p_event_id, p_round_id, 'round_top10', jsonb_build_object('rows', v_rows, 'top10', v_rows, 'round_id', p_round_id));
  else
    insert into public.leaderboard_snapshots(event_id, snapshot_type, payload)
    values (p_event_id, 'round_top10', jsonb_build_object('rows', v_rows, 'top10', v_rows, 'round_id', p_round_id));
  end if;

  return jsonb_build_object('ok', true, 'count', jsonb_array_length(v_rows), 'rows', v_rows);
end;
$$;

create or replace function public.build_overall_leaderboard(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_has_round boolean;
begin
  if auth.uid() is null or not private.is_event_admin(p_event_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank), '[]'::jsonb)
  into v_rows
  from (
    select
      row_number() over (order by sum(coalesce(a.score, 0)) desc, min(a.submitted_at) asc nulls last)::int as rank,
      a.participant_id,
      coalesce(nullif(trim(max(ep.display_name)), ''), 'Participant') as display_name,
      sum(coalesce(a.score, 0))::numeric as score,
      sum(coalesce(a.score, 0))::numeric as total_score
    from public.attempts a
    join public.event_participants ep on ep.id = a.participant_id
    where a.event_id = p_event_id
      and a.status in ('completed', 'timed_out', 'recovered', 'terminated')
    group by a.participant_id
  ) t;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leaderboard_snapshots' and column_name = 'round_id'
  ) into v_has_round;

  if v_has_round then
    insert into public.leaderboard_snapshots(event_id, round_id, snapshot_type, payload)
    values (p_event_id, null, 'overall_top10', jsonb_build_object('rows', v_rows, 'top10', v_rows, 'leaderboard', v_rows));
  else
    insert into public.leaderboard_snapshots(event_id, snapshot_type, payload)
    values (p_event_id, 'overall_top10', jsonb_build_object('rows', v_rows, 'top10', v_rows, 'leaderboard', v_rows));
  end if;

  return jsonb_build_object('ok', true, 'count', jsonb_array_length(v_rows), 'rows', v_rows);
end;
$$;

revoke all on function public.build_round_top10(uuid, uuid) from public;
revoke all on function public.build_overall_leaderboard(uuid) from public;
grant execute on function public.build_round_top10(uuid, uuid) to authenticated;
grant execute on function public.build_overall_leaderboard(uuid) to authenticated;
