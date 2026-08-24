-- Private question-media bucket and admin/editor-only access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-media','question-media',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/mp4','audio/wav'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

revoke execute on function public.begin_final_question(uuid, uuid) from anon;
revoke execute on function public.begin_quiz_question(uuid, uuid) from anon;
revoke execute on function public.complete_final_and_mark_questions(uuid) from anon;
revoke execute on function public.finish_final(uuid) from anon;
revoke execute on function public.resolve_sudden_death(uuid) from anon;
revoke execute on function public.start_sudden_death(uuid, uuid) from anon;
revoke execute on function public.submit_final_response(uuid, uuid, text) from anon;
revoke execute on function public.submit_sudden_death_response(uuid, uuid, text) from anon;
revoke execute on function public.void_round_question(uuid, uuid, uuid, text) from anon;

create policy "question media admin read" on storage.objects for select to authenticated using (bucket_id='question-media' and exists(select 1 from public.event_admins ea where ea.user_id=auth.uid() and ea.event_id::text=(storage.foldername(name))[1]));
create policy "question media admin insert" on storage.objects for insert to authenticated with check (bucket_id='question-media' and exists(select 1 from public.event_admins ea where ea.user_id=auth.uid() and ea.event_id::text=(storage.foldername(name))[1]));
create policy "question media admin update" on storage.objects for update to authenticated using (bucket_id='question-media' and exists(select 1 from public.event_admins ea where ea.user_id=auth.uid() and ea.event_id::text=(storage.foldername(name))[1])) with check (bucket_id='question-media' and exists(select 1 from public.event_admins ea where ea.user_id=auth.uid() and ea.event_id::text=(storage.foldername(name))[1]));
create policy "question media admin delete" on storage.objects for delete to authenticated using (bucket_id='question-media' and exists(select 1 from public.event_admins ea where ea.user_id=auth.uid() and ea.event_id::text=(storage.foldername(name))[1]));
