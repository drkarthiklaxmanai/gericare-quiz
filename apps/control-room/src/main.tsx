import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const supabase=url&&key?createClient(url,key):null;

type Round={id:string;event_id:string;round_number:number;title:string;status:string;questions_locked:boolean};
type Attempt={id:string;participant_id:string;round_id:string;status:string;score:number;started_at:string|null;deadline_at:string|null;submitted_at:string|null};
type Integrity={id:number;participant_id:string|null;event:string;occurred_at:string;metadata:Record<string,unknown>|null};
type Board={rank:number;participant_id?:string;display_name?:string;name?:string;score:number};
type Finalist={id:string;participant_id:string;preliminary_score:number;preliminary_time_ms:number;rank:number;status:string};
type Sudden={id:string;question_number:number;question_id:string;created_at:string};

function errText(e:unknown):string{
  if(e==null)return 'Unknown error';
  if(typeof e==='string')return e;
  if(e instanceof Error)return e.message||e.name;
  if(typeof e==='object'){
    const o=e as Record<string,unknown>;
    const parts=[o.message,o.details,o.hint,o.code].filter(x=>typeof x==='string'&&String(x).trim());
    if(parts.length)return parts.map(String).join(' — ');
    try{return JSON.stringify(e)}catch{return 'Request failed'}
  }
  return String(e);
}

async function rpc(name:string,args:Record<string,unknown>={}){
  if(!supabase)throw Error('Supabase environment not configured');
  const{data,error}=await supabase.rpc(name,args);
  if(error)throw error;
  return data;
}

function App(){
  const[eventId,setEventId]=useState('');
  const[rounds,setRounds]=useState<Round[]>([]);
  const[attempts,setAttempts]=useState<Attempt[]>([]);
  const[integrity,setIntegrity]=useState<Integrity[]>([]);
  const[board,setBoard]=useState<Board[]>([]);
  const[finalists,setFinalists]=useState<Finalist[]>([]);
  const[sudden,setSudden]=useState<Sudden|null>(null);
  const[suddenQuestion,setSuddenQuestion]=useState('');
  const[selected,setSelected]=useState<Round|null>(null);
  const[message,setMessage]=useState('Ready');
  const[locked,setLocked]=useState(false);

  const resolveEvent=async()=>{
    if(eventId)return eventId;
    if(!supabase)throw Error('Supabase not configured');
    const configured=import.meta.env.VITE_EVENT_ID as string|undefined;
    let q=supabase.from('events').select('id');
    if(configured)q=q.eq('id',configured);
    const{data,error}=await q.limit(1).maybeSingle();
    if(error)throw error;
    if(!data)throw Error('No accessible event');
    setEventId(data.id);
    return data.id;
  };

  const load=async()=>{
    if(!supabase){setMessage('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');return}
    try{
      const eid=await resolveEvent();
      const [{data:r,error:re},{data:a,error:ae},{data:i,error:ie},{data:s,error:se},{data:f,error:fe},{data:sd,error:sde}]=await Promise.all([
        supabase.from('rounds').select('id,event_id,round_number,title,status,questions_locked').eq('event_id',eid).order('round_number'),
        supabase.from('attempts').select('id,participant_id,round_id,status,score,started_at,deadline_at,submitted_at').eq('event_id',eid).order('started_at',{ascending:false}).limit(500),
        supabase.from('integrity_events').select('id,participant_id,event,occurred_at,metadata').eq('event_id',eid).order('occurred_at',{ascending:false}).limit(100),
        supabase.from('leaderboard_snapshots').select('payload').eq('event_id',eid).order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.from('finalists').select('id,participant_id,preliminary_score,preliminary_time_ms,rank,status').eq('event_id',eid).order('rank'),
        supabase.from('sudden_death_attempts').select('id,question_number,question_id,created_at').eq('event_id',eid).order('question_number',{ascending:false}).limit(1).maybeSingle(),
      ]);
      if(re||ae||ie||se||fe||sde)throw(re||ae||ie||se||fe||sde);
      setRounds(r??[]);
      setAttempts(a??[]);
      setIntegrity(i??[]);
      setFinalists(f??[]);
      setSudden(sd??null);
      const payload=s?.payload as any;
      setBoard(Array.isArray(payload)?payload:(payload?.rows??payload?.leaderboard??[]));
      setSelected(prev=>{
        if(!prev)return prev;
        const fresh=(r??[]).find(x=>x.id===prev.id);
        return fresh??prev;
      });
    }catch(e){setMessage(errText(e))}
  };

  useEffect(()=>{
    void load();
    if(!supabase)return;
    const ch=supabase.channel('control-room-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'rounds'},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'attempts'},()=>void load())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'integrity_events'},()=>void load())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'leaderboard_snapshots'},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'finalists'},()=>void load())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'sudden_death_attempts'},()=>void load())
      .subscribe();
    return()=>{supabase.removeChannel(ch)};
  },[eventId]);

  const action=async(label:string,fn:()=>Promise<unknown>)=>{
    try{
      setMessage(label+'…');
      await fn();
      setMessage(label+' — OK');
      await load();
    }catch(e){
      setMessage(label+' failed: '+errText(e));
    }
  };

  const control=(r:Round)=>action('Take control',async()=>{
    await rpc('acquire_control_lock',{p_event_id:r.event_id});
    setSelected(r);
    setLocked(true);
  });
  const open=(r:Round)=>action('Open round',()=>rpc('open_round',{p_event_id:r.event_id,p_round_id:r.id}));
  const close=(r:Round)=>action('Close round',()=>rpc('close_round',{p_event_id:r.event_id,p_round_id:r.id}));
  const release=(r:Round)=>action('Release results',async()=>{
    await rpc('release_round_results',{p_event_id:r.event_id,p_round_id:r.id});
    await rpc('build_round_top10',{p_event_id:r.event_id,p_round_id:r.id});
    await rpc('build_overall_leaderboard',{p_event_id:r.event_id});
  });

  const active=useMemo(()=>rounds.find(r=>r.status==='open')??selected,[rounds,selected]);

  const present=(state:string,payload:Record<string,unknown>={})=>
    eventId?action(`Projector → ${state}`,()=>rpc('publish_presentation_state',{
      p_event_id:eventId,
      p_state:state,
      p_round_id:active?.id??null,
      p_title:null,
      p_question:null,
      p_options:[],
      p_answer:null,
      p_explanation:null,
      p_top10:state.includes('LEADER')||state.includes('TOP10')?board:[],
      p_media:[],
      ...payload,
    })):Promise.resolve();

  const qualify=()=>action('Qualify Top 10',()=>rpc('qualify_finalists',{p_event_id:eventId}));
  const startFinal=()=>action('Start Grand Final',async()=>{
    await rpc('start_final',{p_event_id:eventId});
    await present('FINAL',{p_title:'Grand Final'});
  });
  const finalBoard=()=>action('Build final leaderboard',()=>rpc('build_final_leaderboard',{p_event_id:eventId}));
  const complete=()=>action('Complete event',async()=>{
    await rpc('complete_event',{p_event_id:eventId});
    await present('WINNER');
  });
  const startSudden=()=>action('Start sudden death',async()=>{
    if(!suddenQuestion.trim())throw Error('Enter a prepared sudden-death question UUID');
    await rpc('start_sudden_death',{p_event_id:eventId,p_question_id:suddenQuestion.trim()});
    setSuddenQuestion('');
  });
  const resolveSudden=()=>action('Resolve sudden death',async()=>{
    if(!sudden)throw Error('No active sudden-death question');
    await rpc('resolve_sudden_death',{p_sudden_death_id:sudden.id});
  });

  const currentAttempts=active?attempts.filter(a=>a.round_id===active.id):attempts;
  const counts={
    active:currentAttempts.filter(a=>a.status==='active').length,
    submitted:currentAttempts.filter(a=>['completed','timed_out','recovered'].includes(a.status)).length,
    terminated:currentAttempts.filter(a=>a.status==='terminated').length,
  };

  return (
    <div className="shell">
      <header>
        <div>
          <div className="eyebrow">GERiCARE • LIVE OPERATIONS</div>
          <h1>Control Room</h1>
        </div>
        <div className={locked?'lock on':'lock'}>{locked?'● LIVE CONTROL':'○ VIEW ONLY'}</div>
      </header>
      <main>
        <section className="hero">
          <div>
            <span className="label">CURRENT ROUND</span>
            <h2>{active?`Round ${active.round_number} — ${active.title}`:'No active round'}</h2>
            <p className="status-line">{message}</p>
            {active&&(
              <p className="muted-line">
                Status: <b>{active.status}</b>
                {' · '}
                Questions: <b>{active.questions_locked?'LOCKED':'not locked'}</b>
              </p>
            )}
          </div>
          <div className="actions">
            {active&&(
              <>
                <button type="button" onClick={()=>control(active)}>Take Control</button>
                <button type="button" onClick={()=>open(active)} disabled={!active.questions_locked}>Open</button>
                <button type="button" onClick={()=>close(active)}>Close</button>
                <button type="button" onClick={()=>release(active)}>Release Results</button>
              </>
            )}
          </div>
        </section>

        <section className="panel" style={{marginTop:18}}>
          <h3>Projector</h3>
          <div className="actions">
            <button type="button" onClick={()=>present('WAITING')}>Waiting</button>
            <button type="button" onClick={()=>present('RULES',{p_title:'How to Play'})}>Rules</button>
            <button type="button" onClick={()=>present('ROUND_TOP10')}>Round Top 10</button>
            <button type="button" onClick={()=>present('LEADERBOARD')}>Overall Leaderboard</button>
            <button type="button" onClick={()=>present('FINAL',{p_title:'Grand Final'})}>Final</button>
            <button type="button" onClick={()=>present('WINNER')}>Winner</button>
          </div>
        </section>

        <section className="panel" style={{marginTop:18}}>
          <h3>Grand Final Operations</h3>
          <div className="actions">
            <button type="button" onClick={qualify}>Qualify Top 10</button>
            <button type="button" onClick={startFinal}>Start Final</button>
            <button type="button" onClick={finalBoard}>Build Final Leaderboard</button>
            <button type="button" onClick={complete}>Complete Event</button>
          </div>
          <div className="stats" style={{marginTop:14}}>
            <div><b>{finalists.length}</b><span>Finalists</span></div>
            <div><b>{finalists.filter(f=>f.status==='completed'||f.status==='ranked').length}</b><span>Finished</span></div>
          </div>
          <div className="table">
            {finalists.slice(0,10).map(f=>(
              <div className="tr" key={f.id}>
                <b>#{f.rank}</b>
                <strong>{f.participant_id.slice(0,8)}</strong>
                <span>{f.preliminary_score} prelim</span>
              </div>
            ))}
          </div>
          <h3 style={{marginTop:20}}>Sudden Death</h3>
          <div className="actions">
            <input value={suddenQuestion} onChange={e=>setSuddenQuestion(e.target.value)} placeholder="Prepared question UUID"/>
            <button type="button" onClick={startSudden}>Start Question</button>
            <button type="button" disabled={!sudden} onClick={resolveSudden}>Resolve Current</button>
          </div>
          {sudden&&<p className="muted">Current sudden-death question #{sudden.question_number} · {sudden.question_id}</p>}
        </section>

        <section className="grid">
          <div className="panel rounds">
            <h3>Rounds</h3>
            {rounds.map(r=>(
              <button type="button" className={'row '+(selected?.id===r.id?'selected':'')} key={r.id} onClick={()=>setSelected(r)}>
                <span>R{r.round_number}</span>
                <strong>{r.title}</strong>
                <em>{r.status}{r.questions_locked?' · locked':''}</em>
              </button>
            ))}
            {!rounds.length&&<p className="muted">No rounds configured.</p>}
          </div>
          <div className="panel">
            <h3>Participant Monitor</h3>
            <div className="stats">
              <div><b>{counts.active}</b><span>Active</span></div>
              <div><b>{counts.submitted}</b><span>Submitted</span></div>
              <div><b>{counts.terminated}</b><span>Terminated</span></div>
            </div>
            <div className="table">
              {currentAttempts.slice(0,12).map(a=>(
                <div className="tr" key={a.id}>
                  <span>{a.participant_id.slice(0,8)}</span>
                  <strong>{a.status}</strong>
                  <span>{a.score} pts</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Leaderboard</h3>
            {board.length?(
              <div className="table">
                {board.slice(0,10).map((b,i)=>(
                  <div className="tr" key={b.participant_id??i}>
                    <b>#{b.rank??i+1}</b>
                    <strong>{b.display_name??b.name??'Participant'}</strong>
                    <span>{b.score}</span>
                  </div>
                ))}
              </div>
            ):(
              <p className="muted">Released leaderboard snapshots will appear here.</p>
            )}
          </div>
          <div className="panel">
            <h3>Integrity Monitor</h3>
            {integrity.slice(0,10).map(x=>(
              <div className="tr" key={x.id}>
                <span>{new Date(x.occurred_at).toLocaleTimeString()}</span>
                <strong>{x.event}</strong>
                <span>{x.participant_id?.slice(0,8)??'—'}</span>
              </div>
            ))}
            {!integrity.length&&<p className="muted">No integrity events.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
