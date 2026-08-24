import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined,key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const supabase=url&&key?createClient(url,key):null;
type DisplayState={state:string;round_number?:number;title?:string;question?:string;options?:string[];answer?:string;explanation?:string;top10?:{rank:number;name:string;score:number}[];updated_at?:string};
const demo:DisplayState={state:'WAITING',title:'GERiCARE Conference Quiz'};
function App(){const [view,setView]=useState<DisplayState>(demo),[connected,setConnected]=useState(false);
 useEffect(()=>{if(!supabase)return;const load=async()=>{const {data}=await supabase.from('presentation_state').select('*').order('updated_at',{ascending:false}).limit(1).maybeSingle();if(data)setView(data as DisplayState)};load();const ch=supabase.channel('projector-display').on('postgres_changes',{event:'*',schema:'public',table:'presentation_state'},p=>{if(p.new)setView(p.new as DisplayState)}).subscribe(s=>setConnected(s==='SUBSCRIBED'));return()=>{supabase.removeChannel(ch)}},[]);
 const content=()=>{switch(view.state){case'RULES':return <><small>RULES</small><h1>How to Play</h1><p>Answer each question before your timer expires.</p></>;case'QUESTION':return <><small>ROUND {view.round_number}</small><h2>{view.question}</h2><div className="options">{(view.options??[]).map((x,i)=><div key={i}><b>{String.fromCharCode(65+i)}</b>{x}</div>)}</div></>;case'ANSWER_REVEAL':return <><small>ANSWER</small><h1>{view.answer??'Correct answer'}</h1></>;case'EXPLANATION':return <><small>EXPLANATION</small><h2>{view.explanation}</h2></>;case'ROUND_TOP10':case'LEADERBOARD':return <><small>{view.state==='ROUND_TOP10'?'ROUND TOP 10':'LEADERBOARD'}</small><h1>Leaderboard</h1><div className="board">{(view.top10??[]).map(x=><div><b>#{x.rank}</b><span>{x.name}</span><strong>{x.score}</strong></div>)}</div></>;case'FINAL':return <><small>GRAND FINAL</small><h1>{view.question??'Final'}</h1></>;case'WINNER':return <><small>WINNER</small><h1>{view.title??'Congratulations!'}</h1></>;default:return <><small>GERiCARE</small><h1>{view.title??'Quiz will begin shortly'}</h1><p>Get ready.</p></>}};
 return <main><div className="status">{connected?'LIVE':'RECONNECTING'}</div><section>{content()}</section></main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
