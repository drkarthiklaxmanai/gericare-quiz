drop policy if exists "own responses" on public.responses;
create policy "responses admin or released owner" on public.responses
for select to authenticated
using (
  exists (select 1 from public.attempts a where a.id=responses.attempt_id and (select private.is_event_admin(a.event_id)))
  or exists (
    select 1 from public.attempts a join public.event_participants ep on ep.id=a.participant_id
    where a.id=responses.attempt_id and ep.user_id=(select auth.uid())
      and a.result_released_at is not null and a.result_released_at <= clock_timestamp()
  )
);

drop policy if exists "rounds participant read" on public.rounds;
create policy "rounds participant read" on public.rounds
for select to authenticated
using (exists(select 1 from public.event_participants ep where ep.event_id=rounds.event_id and ep.user_id=(select auth.uid())));
