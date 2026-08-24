update public.events
set settings=jsonb_set(settings,'{round_duration_seconds}','600'::jsonb,true),updated_at=now();
alter table public.events alter column settings set default jsonb_build_object('preliminary_rounds',6,'questions_per_round',3,'question_points',10,'round_duration_seconds',600,'result_release_delay_seconds',900,'round6_optional',true,'best_preliminary_rounds',5,'final_questions',10,'final_duration_seconds',600,'final_question_points',10,'connectivity_grace_seconds',20,'visibility_warning_limit',2);
