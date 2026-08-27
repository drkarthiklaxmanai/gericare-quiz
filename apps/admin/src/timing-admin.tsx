import React,{useEffect,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
import{createClient}from'@supabase/supabase-js';
import'./styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const sb=createClient(url,key);

type TimerData={prelim_seconds?:number;final_seconds?:number};
function errText(e:unknown){
 if(e instanceof Error)return e.message;
 if(e&&typeof e==='object'){
  const o=e as Record<string,unknown>;
  return [o.message,o.details,o.hint,o.code].filter(Boolean).map(String).join(' — ')||JSON.stringify(o);
 }
 return String(e);
}

function App(){
 const[eventId,setEventId]=useState(configuredEvent??'');
 const[prelim,setPrelim]=useState<number|null>(null);
 const[finalSec,setFinalSec]=useState<number|null>(null);
 const[busy,setBusy]=useState(false);
 const[loading,setLoading]=useState(true);
 const[msg,setMsg]=useState('');
 const dirty=useRef(false);

 const resolveEvent=async()=>{
  if(configuredEvent)return configuredEvent;
  const{data:{user},error:ue}=await sb.auth.getUser();
  if(ue||!user)throw ue??Error('Authentication required');
  const{data:access,error:ae}=await sb.from('event_admins').select('event_id').eq('user_id',user.id).eq('role','super_admin').limit(1).maybeSingle();
  if(ae)throw ae;
  if(!access?.event_id)throw Error('No super-admin event access found');
  return String(access.event_id);
 };

 const load=async()=>{
  setLoading(true);
  try{
   const eid=eventId||await resolveEvent();
   setEventId(eid);
   const{data,error}=await sb.rpc('get_quiz_timers',{p_event_id:eid});
   if(error)throw error;
   const timers=(data??{}) as TimerData;
   if(!dirty.current){
    setPrelim(Number(timers.prelim_seconds??90));
    setFinalSec(Number(timers.final_seconds??600));
   }
  }finally{setLoading(false)}
 };

 useEffect(()=>{void load().catch(e=>setMsg(errText(e)))},[]);

 const save=async()=>{
  if(!eventId||prelim==null||finalSec==null)return;
  setBusy(true);setMsg('');
  try{
   const{data,error}=await sb.rpc('set_quiz_timers',{p_event_id:eventId,p_prelim_seconds:prelim,p_final_seconds:finalSec});
   if(error)throw error;
   const saved=(data??{}) as TimerData;
   const savedPrelim=Number(saved.prelim_seconds??prelim);
   const savedFinal=Number(saved.final_seconds??finalSec);
   const{data:verify,error:ve}=await sb.rpc('get_quiz_timers',{p_event_id:eventId});
   if(ve)throw ve;
   const persisted=(verify??{}) as TimerData;
   const persistedPrelim=Number(persisted.prelim_seconds??savedPrelim);
   const persistedFinal=Number(persisted.final_seconds??savedFinal);
   if(persistedPrelim!==savedPrelim||persistedFinal!==savedFinal)throw Error(`Timer did not persist. Server returned ${persistedPrelim}s / ${persistedFinal}s.`);
   setPrelim(persistedPrelim);setFinalSec(persistedFinal);dirty.current=false;
   setMsg(`Saved permanently. Prelims ${persistedPrelim}s · Final ${persistedFinal}s`);
  }catch(e){setMsg(`Save failed: ${errText(e)}`)}
  finally{setBusy(false)}
 };

 const prelimValid=prelim!=null&&prelim>=30&&prelim<=900;
 const finalValid=finalSec!=null&&finalSec>=60&&finalSec<=3600;
 return <div className="app">
  <header className="topbar"><div><small>GERICARE</small><h1>Quiz timers</h1></div><div className="pill">Server-authoritative</div></header>
  <div className="wrap"><div className="card" style={{maxWidth:620,margin:'0 auto'}}>
   <p className="hint">These durations are read by the backend when a new preliminary round or final starts. Existing attempts keep their original deadline.</p>
   <div className="section" style={{display:'grid',gap:18}}>
    <label><b>Preliminary round</b><p className="hint">All 3 questions together. Allowed: 30 seconds to 15 minutes.</p><div style={{display:'flex',gap:10,alignItems:'center'}}><input className="search" type="number" min={30} max={900} disabled={loading} value={prelim??''} onChange={e=>{dirty.current=true;setPrelim(e.target.value===''?null:Number(e.target.value))}}/><span>seconds</span></div></label>
    <label><b>Final</b><p className="hint">All final questions together. Allowed: 1 to 60 minutes.</p><div style={{display:'flex',gap:10,alignItems:'center'}}><input className="search" type="number" min={60} max={3600} disabled={loading} value={finalSec??''} onChange={e=>{dirty.current=true;setFinalSec(e.target.value===''?null:Number(e.target.value))}}/><span>seconds</span></div></label>
    {msg&&<div className="pill">{msg}</div>}
    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="btn primary" disabled={loading||busy||!prelimValid||!finalValid} onClick={()=>void save()}>{loading?'Loading…':busy?'Saving…':'Save timers'}</button><a className="btn" href="./">Back to Admin</a></div>
   </div>
  </div></div>
 </div>
}

createRoot(document.getElementById('root')!).render(<App/>);
