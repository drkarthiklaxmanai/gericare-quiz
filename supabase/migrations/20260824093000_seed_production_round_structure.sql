insert into public.rounds(event_id,round_number,title,status,is_optional,questions_locked)
select e.id, v.round_number, v.title, 'draft'::round_status, v.is_optional, false
from public.events e
cross join (values
  (1,'Round 1',false),
  (2,'Round 2',false),
  (3,'Round 3',false),
  (4,'Round 4',false),
  (5,'Round 5',false),
  (6,'Round 6',true)
) as v(round_number,title,is_optional)
where e.is_demo=false and e.name='GERiCARE Conference Quiz'
and not exists (
  select 1 from public.rounds r where r.event_id=e.id and r.round_number=v.round_number
);
