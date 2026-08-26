import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './participants.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const sb=url&&key?createClient(url,key):null;

type Participant={participant_id:string;user_id:string;display_name:string;full_name:string|null;email:string|null;mobile_e164:string|null;institution:string|null;designation:string|null;department:string|null;registered_at:string;is_finalist:boolean;attempts_count:number;answered_count:number;correct_count:number;total_score:number};
type Resp={attempt_id:string;attempt_status:string;attempt_score:number;round_id:string;round_number:number;round_title:string;question_id:string|null;displayed_position:number|null;stem:string|null;selected_option_key:string|null;selected_option_text:string|null;correct_option_key:string|null;correct_option_text:string|null;is_correct:boolean|null;points_awarded:number|null;response_time_ms:number|null;response_submitted_at:string|null};

function textErr(e:unknown){return e instanceof Error?e.message:String(e)}
function App(){
 const[eventId,setEventId]=useState(configuredEvent??''),[rows,setRows]=useState<Participant[]>([]),[selected,setSelected]=useState<Participant|null>(null),[responses,setResponses]=useState<Resp[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('Loading…');
 const resolveEvent=async()=>{if(eventId)return eventId;if(!sb)throw Error('Supabase not configured');const{data,error}=await sb.from('events').select('id').limit(1).maybeSingle();if(error)throw error;if(!data)throw Error('No accessible event');setEventId(data.id);return data.id};
 const load=async()=>{if(!sb)return;try{setBusy(true);const eid=await resolveEvent();const{data,error}=await sb.rpc('admin_participant_roster',{p_event_id:eid});if(error)throw error;setRows((data??[]) as Participant[]);setMessage(`${(data??[]).length} participant${(data??[]).length===1?'':'s'}`)}catch(e){setMessage(textErr(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[]);
 const filtered=useMemo(()=>{const s=search.trim().toLowerCase();if(!s)return rows;return rows.filter(p=>[p.full_name,p.display_name,p.email,p.mobile_e164,p.institution,p.designation,p.department].some(v=>v?.toLowerCase().includes(s)))},[rows,search]);
 const openParticipant=async(p:Participant)=>{if(!sb)return;setSelected(p);setResponses([]);setBusy(true);setMessage('Loading responses…');try{const eid=await resolveEvent();const{data,error}=await sb.rpc('admin_participant_responses',{p_event_id:eid,p_participant_id:p.participant_id});if(error)throw error;setResponses((data??[]) as Resp[]);setMessage(`${p.full_name||p.display_name} · ${(data??[]).filter((x:any)=>x.question_id).length} responses`)}catch(e){setMessage(textErr(e))}finally{setBusy(false)}};
 const roundGroups=useMemo(()=>{const m=new Map<number,Resp[]>();for(const r of responses){if(!m.has(r.round_number))m.set(r.round_number,[]);m.get(r.round_number)!.push(r)}return [...m.entries()].sort((a,b)=>a[0]-b[0])},[responses]);
 return <div className="pa-shell">
   <header className="pa-top"><div><div className="pa-kicker">GERiCARE • ADMIN</div><h1>Participants & Responses</h1></div><a className="pa-link" href="/admin/">Question bank</a></header>
   <main className="pa-main">
     <div className="pa-toolbar"><input placeholder="Search name, email, institution…" value={search} onChange={e=>setSearch(e.target.value)}/><button onClick={()=>void load()} disabled={busy}>Refresh</button></div>
     <div className="pa-status">{message}</div>
     <div className="pa-grid">
       <section className="pa-list">
         {filtered.map(p=><button key={p.participant_id} className={'pa-person'+(selected?.participant_id===p.participant_id?' active':'')} onClick={()=>void openParticipant(p)}>
           <div><strong>{p.full_name||p.display_name}</strong><span>{p.institution||'Institution not provided'}{p.department?` · ${p.department}`:''}</span></div>
           <div className="pa-mini"><b>{p.total_score}</b><span>{p.correct_count}/{p.answered_count}</span></div>
         </button>)}
         {!filtered.length&&<div className="pa-empty">No participants found.</div>}
       </section>
       <section className="pa-detail">
         {!selected&&<div className="pa-empty">Select a participant to view their details and question-by-question responses.</div>}
         {selected&&<>
           <div className="pa-card">
             <div className="pa-headrow"><div><div className="pa-kicker">PARTICIPANT</div><h2>{selected.full_name||selected.display_name}</h2></div>{selected.is_finalist&&<span className="pa-chip">Finalist</span>}</div>
             <div className="pa-info">
               <div><span>Email</span><b>{selected.email||'—'}</b></div><div><span>Phone</span><b>{selected.mobile_e164||'—'}</b></div>
               <div><span>Institution</span><b>{selected.institution||'—'}</b></div><div><span>Designation</span><b>{selected.designation||'—'}</b></div>
               <div><span>Department</span><b>{selected.department||'—'}</b></div><div><span>Registered</span><b>{new Date(selected.registered_at).toLocaleString()}</b></div>
             </div>
             <div className="pa-stats"><div><b>{selected.attempts_count}</b><span>Rounds</span></div><div><b>{selected.answered_count}</b><span>Answered</span></div><div><b>{selected.correct_count}</b><span>Correct</span></div><div><b>{selected.total_score}</b><span>Points</span></div></div>
           </div>
           {roundGroups.map(([rn,items])=>{const meta=items[0];return <div className="pa-card" key={rn}><div className="pa-roundhead"><div><div className="pa-kicker">ROUND {rn}</div><h3>{meta.round_title}</h3></div><div><b>{meta.attempt_score} pts</b><span>{meta.attempt_status}</span></div></div>
             {items.filter(x=>x.question_id).map((r,i)=><div className={'pa-response '+(r.is_correct?'correct':'wrong')} key={`${r.attempt_id}-${r.question_id}-${i}`}>
               <div className="pa-q"><b>{r.displayed_position??i+1}.</b><span>{r.stem}</span></div>
               <div className="pa-answer"><span>Your answer</span><b>{r.selected_option_key?`${r.selected_option_key}. ${r.selected_option_text??''}`:'No answer'}</b></div>
               {!r.is_correct&&<div className="pa-answer"><span>Correct answer</span><b>{r.correct_option_key?`${r.correct_option_key}. ${r.correct_option_text??''}`:'—'}</b></div>}
               <div className="pa-responsemeta"><span>{r.is_correct?'✓ Correct':'✕ Incorrect'}</span><span>{r.points_awarded??0} pts</span><span>{r.response_time_ms!=null?`${(r.response_time_ms/1000).toFixed(1)} s`:'—'}</span></div>
             </div>)}
             {!items.some(x=>x.question_id)&&<div className="pa-empty">No responses recorded for this round.</div>}
           </div>})}
           {!busy&&!responses.length&&<div className="pa-card pa-empty">No attempts or responses recorded yet.</div>}
         </>}
       </section>
     </div>
   </main>
 </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
