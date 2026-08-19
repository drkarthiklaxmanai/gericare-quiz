import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const supabase=url&&key?createClient(url,key):null;

type Round={id:string; round_number:number; title:string; status:string; result_release_at:string|null};
type Participant={id:string; display_name:string; status:string; score:number; integrity:number};

async function rpc(name:string,args:Record<string,unknown>={}){if(!supabase) throw new Error('Supabase environment not configured'); const {data,error}=await supabase.rpc(name,args); if(error) throw error; return data;}

function App(){
 const [rounds,setRounds]=useState<Round[]>([]); const [participants,setParticipants]=useState<Participant[]>([]); const [selected,setSelected]=useState<Round|null>(null); const [message,setMessage]=useState('Ready'); const [locked,setLocked]=useState(false);
 const load=async()=>{if(!supabase){setMessage('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');return;} const {data,error}=await supabase.from('rounds').select('id,round_number,title,status,result_release_at').order('round_number'); if(error)setMessage(error.message); else setRounds(data??[]);};
 useEffect(()=>{load(); if(!supabase)return; const ch=supabase.channel('control-room').on('postgres_changes',{event:'*',schema:'public',table:'rounds'},()=>load()).subscribe(); return()=>{supabase.removeChannel(ch)}},[]);
 const action=async(label:string,fn:()=>Promise<unknown>)=>{try{setMessage(label+'…');await fn();setMessage(label+' complete');await load()}catch(e){setMessage(e instanceof Error?e.message:String(e))}};
 const control=async(r:Round)=>{setSelected(r); await action('Acquiring live control',async()=>{await rpc('acquire_live_control',{p_event_id:null})}); setLocked(true)};
 const openRound=async(r:Round)=>action('Opening round',async()=>{await rpc('open_round',{p_round_id:r.id})});
 const closeRound=async(r:Round)=>action('Closing round',async()=>{await rpc('close_round',{p_round_id:r.id})});
 const release=async(r:Round)=>action('Releasing results',async()=>{await rpc('release_round_results',{p_round_id:r.id})});
 const active=useMemo(()=>rounds.find(r=>r.status==='live')??selected,[rounds,selected]);
 return <div className="shell"><header><div><div className="eyebrow">GERiCARE • LIVE OPERATIONS</div><h1>Control Room</h1></div><div className={locked?'lock on':'lock'}>{locked?'● LIVE CONTROL':'○ VIEW ONLY'}</div></header>
 <main><section className="hero"><div><span className="label">CURRENT</span><h2>{active?`Round ${active.round_number} — ${active.title}`:'No active round'}</h2><p>{message}</p></div><div className="actions">{active&&<><button onClick={()=>control(active)}>Take Control</button><button onClick={()=>openRound(active)}>Open</button><button onClick={()=>closeRound(active)}>Close</button><button onClick={()=>release(active)}>Release Results</button></>}</div></section>
 <section className="grid"><div className="panel"><h3>Rounds</h3>{rounds.map(r=><button className={'row '+(selected?.id===r.id?'selected':'')} key={r.id} onClick={()=>setSelected(r)}><span>R{r.round_number}</span><strong>{r.title}</strong><em>{r.status}</em></button>)}{!rounds.length&&<p className="muted">No rounds configured.</p>}</div><div className="panel"><h3>Participants</h3><div className="stats"><div><b>{participants.length}</b><span>Active</span></div><div><b>—</b><span>Submitted</span></div><div><b>—</b><span>Integrity</span></div></div><p className="muted">Participant monitoring will populate from live attempts.</p></div><div className="panel"><h3>Leaderboard</h3><p className="muted">Top 10 and rank movement appear after a released result snapshot.</p></div><div className="panel"><h3>Integrity Monitor</h3><p className="muted">Visibility violations, reconnects and terminated attempts will appear here.</p></div></section></main></div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
