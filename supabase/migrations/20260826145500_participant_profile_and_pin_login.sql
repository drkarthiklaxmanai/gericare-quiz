create extension if not exists pgcrypto with schema extensions;

alter table public.profiles add column if not exists institution text;
alter table public.profiles add column if not exists designation text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists profile_completed_at timestamptz;

create table if not exists private.participant_pin_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  pin_set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.participant_login_state()
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private'
as $$
declare
  v_uid uuid:=auth.uid();
  v_profile public.profiles%rowtype;
  v_pin boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.profiles where id=v_uid;
  select exists(select 1 from private.participant_pin_credentials where user_id=v_uid) into v_pin;
  return jsonb_build_object(
    'profile_complete', v_profile.id is not null and v_profile.profile_completed_at is not null,
    'pin_set', v_pin,
    'full_name', case when v_profile.id is null then null else v_profile.full_name end,
    'institution', case when v_profile.id is null then null else v_profile.institution end,
    'designation', case when v_profile.id is null then null else v_profile.designation end,
    'department', case when v_profile.id is null then null else v_profile.department end,
    'mobile_e164', case when v_profile.id is null then null else v_profile.mobile_e164 end
  );
end;$$;

create or replace function public.save_participant_profile(
  p_full_name text,
  p_institution text,
  p_designation text,
  p_department text,
  p_mobile text
)
returns public.profiles
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_uid uuid:=auth.uid();
  v_mobile text;
  v_result public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_full_name),'') is null then raise exception 'Name required'; end if;
  if nullif(btrim(p_institution),'') is null then raise exception 'Institution required'; end if;
  if nullif(btrim(p_designation),'') is null then raise exception 'Designation required'; end if;
  if nullif(btrim(p_department),'') is null then raise exception 'Department required'; end if;
  v_mobile:=regexp_replace(coalesce(p_mobile,''),'[^0-9+]','','g');
  if v_mobile ~ '^[6-9][0-9]{9}$' then v_mobile:='+91'||v_mobile;
  elsif v_mobile ~ '^91[6-9][0-9]{9}$' then v_mobile:='+'||v_mobile;
  end if;
  if v_mobile !~ '^\+91[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;

  insert into public.profiles(id,full_name,display_name,email,mobile_e164,institution,designation,department,profile_completed_at)
  values(v_uid,btrim(p_full_name),btrim(p_full_name),(select email from auth.users where id=v_uid),v_mobile,btrim(p_institution),btrim(p_designation),btrim(p_department),now())
  on conflict(id) do update set
    full_name=excluded.full_name,
    display_name=excluded.display_name,
    email=excluded.email,
    mobile_e164=excluded.mobile_e164,
    institution=excluded.institution,
    designation=excluded.designation,
    department=excluded.department,
    profile_completed_at=now(),
    updated_at=now()
  returning * into v_result;
  return v_result;
end;$$;

create or replace function public.set_participant_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions'
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and profile_completed_at is not null) then raise exception 'Complete participant profile first'; end if;
  insert into private.participant_pin_credentials(user_id,pin_hash,failed_attempts,locked_until,pin_set_at,updated_at)
  values(v_uid,extensions.crypt(p_pin,extensions.gen_salt('bf',8)),0,null,now(),now())
  on conflict(user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,pin_set_at=now(),updated_at=now();
  return jsonb_build_object('ok',true);
end;$$;

create or replace function public.verify_participant_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','private','extensions'
as $$
declare
  v_uid uuid:=auth.uid();
  v private.participant_pin_credentials%rowtype;
  v_failed integer;
  v_lock timestamptz;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v from private.participant_pin_credentials where user_id=v_uid for update;
  if v.user_id is null then return jsonb_build_object('ok',false,'error','pin_not_set'); end if;
  if v.locked_until is not null and v.locked_until>clock_timestamp() then
    return jsonb_build_object('ok',false,'error','locked','locked_until',v.locked_until);
  end if;
  if p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin,v.pin_hash)=v.pin_hash then
    update private.participant_pin_credentials set failed_attempts=0,locked_until=null,updated_at=now() where user_id=v_uid;
    return jsonb_build_object('ok',true);
  end if;
  v_failed:=coalesce(v.failed_attempts,0)+1;
  if v_failed>=5 then v_lock:=clock_timestamp()+interval '10 minutes'; else v_lock:=null; end if;
  update private.participant_pin_credentials set failed_attempts=case when v_failed>=5 then 0 else v_failed end,locked_until=v_lock,updated_at=now() where user_id=v_uid;
  return jsonb_build_object('ok',false,'error',case when v_failed>=5 then 'locked' else 'invalid_pin' end,'remaining_attempts',greatest(0,5-v_failed),'locked_until',v_lock);
end;$$;

revoke all on function public.participant_login_state() from public,anon;
revoke all on function public.save_participant_profile(text,text,text,text,text) from public,anon;
revoke all on function public.set_participant_pin(text) from public,anon;
revoke all on function public.verify_participant_pin(text) from public,anon;
grant execute on function public.participant_login_state() to authenticated;
grant execute on function public.save_participant_profile(text,text,text,text,text) to authenticated;
grant execute on function public.set_participant_pin(text) to authenticated;
grant execute on function public.verify_participant_pin(text) to authenticated;
