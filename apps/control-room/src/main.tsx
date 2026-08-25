import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const supabase=url&&key?createClient(url,key):null;

type Round={id:string;event_id:string;round_number:number;title:string;status:string;questions_locked:boolean};
type Attempt={id:string;participant_id:string;round_id:string;status:string;score:number;started_at:string|null;deadline_at:string|null;submitted_at:string|null};
type Integrity={id:number;participant_id:string|null;event:string;occurred_at:string};
type Board={rank:number;participant_id?:string;display_name?:string;name?:string;score:number};
type Finalist={id:string;participant_id:string;preliminary_score:number;rank:number;status:string};
type Sudden={id:string;question_number:number;question_id:string};

function errText(e:unknown):string{
  if(e==null)return 'Unknown error';
  if(typeof e==='string')return e;
  if(e instanceof Error&&e.message)return e.message;
  if(typeof e==='object'){
    const o=e as Record<string,unknown>;
    const parts=[o.message,o.details,o.hint,o.code].filter(v=>typeof v==='string'&&String(v).trim()).map(String);
    if(parts.length)return parts.join(' — ');
  }
  try{return JSON.stringify(e)}catch{return String(e)}
}

function normalizeBoard(rows:Board[]){
  return (rows??[]).map((b,i)=>({
    rank:Number(b.rank??i+1)||i+1,
    name:String(b.display_name??b.name??'Participant').trim()||'Participant',
    display_name:String(b.display_name??b.name??'Participant').trim()||'Participant',
    score:Number(b.score??0)||0,
    participant_id:b.participant_id,
  }));
}

async function rpc(name:string,args:Record<string,unknown>={}){
  if(!supabase)throw Error('Supabase not configured');
  const{data,error}=await supabase.rpc(name,args);
  if(error)throw error;
  return data;
}

/** Human next step for selected round */
function nextStep(r:Round|null,locked:boolean,openOther:Round|undefined):{title:string;detail:string;primary?:'control'|'open'|'close'|'release';primaryLabel?:string;blocked?:string}{
  if(!r)return{title:'Select a round',detail:'Tap a round below to control it.'};
  if(!locked)return{title:'Take control first',detail:'Only the operator with live control can open or close rounds.',primary:'control',primaryLabel:'Take control'};
  if(!r.questions_locked)return{title:'Questions not frozen',detail:'In Admin, put 3 questions in this round and Lock the set first.',blocked:'Go to Admin → freeze this round’s 3 questions'};
  if(openOther&&openOther.id!==r.id)return{title:`Close Round ${openOther.round_number} first`,detail:'Only one round can be open at a time.',blocked:`Select R${openOther.round_number} and press Close`};
  const s=r.status;
  if(s==='draft'||s==='locked')return{title:`Open Round ${r.round_number}`,detail:'Participants can start answering once you open.',primary:'open',primaryLabel:'Open round'};
  if(s==='open')return{title:`Close Round ${r.round_number}`,detail:'Stop new answers, then release results when ready.',primary:'close',primaryLabel:'Close round'};
  if(s==='closed')return{title:'Release results',detail:'Publish scores and update the leaderboard / projector.',primary:'release',primaryLabel:'Release results'};
  if(s==='released'||s==='completed')return{title:`Round ${r.round_number} finished`,detail:'Results released. Select the next round or run Final ops.'};
  return{title:`Round ${r.round_number}`,detail:`Status: ${s}`};
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
  const[msgKind,setMsgKind]=useState<'ok'|'err'|'info'>('info');
  const[locked,setLocked]=useState(false);
  const lockEventRef=useRef<string|null>(null);

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
    if(!supabase){setMessage('Configure Supabase env');setMsgKind('err');return}
    try{
      const eid=await resolveEvent();
      const [{data:r,error:re},{data:a,error:ae},{data:i,error:ie},{data:s,error:se},{data:f,error:fe},{data:sd,error:sde}]=await Promise.all([
        supabase.from('rounds').select('id,event_id,round_number,title,status,questions_locked').eq('event_id',eid).order('round_number'),
        supabase.from('attempts').select('id,participant_id,round_id,status,score,started_at,deadline_at,submitted_at').eq('event_id',eid).order('started_at',{ascending:false}).limit(500),
        supabase.from('integrity_events').select('id,participant_id,event,occurred_at').eq('event_id',eid).order('occurred_at',{ascending:false}).limit(50),
        supabase.from('leaderboard_snapshots').select('payload').eq('event_id',eid).order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.from('finalists').select('id,participant_id,preliminary_score,rank,status').eq('event_id',eid).order('rank'),
        supabase.from('sudden_death_attempts').select('id,question_number,question_id').eq('event_id',eid).order('question_number',{ascending:false}).limit(1).maybeSingle(),
      ]);
      if(re||ae||ie||se||fe||sde)throw(re||ae||ie||se||fe||sde);
      setRounds(r??[]);
      setAttempts(a??[]);
      setIntegrity(i??[]);
      setFinalists(f??[]);
      setSudden(sd??null);
      const payload=s?.payload as any;
      const rows=Array.isArray(payload)?payload:(payload?.rows??payload?.leaderboard??[]);
      setBoard(normalizeBoard(rows??[]));
      setSelected(prev=>{
        if(prev){
          const updated=(r??[]).find(x=>x.id===prev.id);
          if(updated)return updated;
        }
        const open=(r??[]).find(x=>x.status==='open');
        return open??(r??[])[0]??null;
      });
    }catch(e){setMessage(errText(e));setMsgKind('err')}
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

  useEffect(()=>{
    if(!locked||!lockEventRef.current)return;
    const eid=lockEventRef.current;
    const id=window.setInterval(()=>{void rpc('acquire_control_lock',{p_event_id:eid}).catch(()=>{})},12_000);
    return()=>window.clearInterval(id);
  },[locked]);

  const run=async(label:string,fn:()=>Promise<unknown>)=>{
    try{
      setMessage(label+'…');setMsgKind('info');
      await fn();
      setMessage(label+' — done');setMsgKind('ok');
      await load();
    }catch(e){setMessage(errText(e));setMsgKind('err')}
  };

  const takeControl=()=>selected&&run('Take control',async()=>{
    await rpc('acquire_control_lock',{p_event_id:selected.event_id});
    lockEventRef.current=selected.event_id;
    setLocked(true);
  });

  const openRound=()=>selected&&run('Open round',async()=>{
    const other=rounds.find(x=>x.status==='open'&&x.id!==selected.id);
    if(other)throw Error(`Close Round ${other.round_number} first`);
    if(!selected.questions_locked)throw Error('Freeze 3 questions in Admin first');
    await rpc('open_round',{p_event_id:selected.event_id,p_round_id:selected.id});
  });

  const closeRound=()=>selected&&run('Close round',()=>rpc('close_round',{p_event_id:selected.event_id,p_round_id:selected.id}));

  const releaseResults=()=>selected&&run('Release results',async()=>{
    await rpc('release_round_results',{p_event_id:selected.event_id,p_round_id:selected.id});
    await rpc('build_round_top10',{p_event_id:selected.event_id,p_round_id:selected.id});
    await rpc('build_overall_leaderboard',{p_event_id:selected.event_id});
  });

  const openOther=rounds.find(r=>r.status==='open');
  const step=nextStep(selected,locked,openOther&&selected&&openOther.id!==selected.id?openOther:undefined);

  const present=(state:string,payload:Record<string,unknown>={})=>
    eventId&&run(`Projector → ${state}`,()=>rpc('publish_presentation_state',{
      p_event_id:eventId,
      p_state:state,
      p_round_id:selected?.id??null,
      p_title:null,
      p_question:null,
      p_options:[],
      p_answer:null,
      p_explanation:null,
      p_top10:state.includes('LEADER')||state.includes('TOP10')?normalizeBoard(board):[],
      p_media:[],
      ...payload,
    }));

  const doPrimary=()=>{
    if(step.primary==='control')void takeControl();
    if(step.primary==='open')void openRound();
    if(step.primary==='close')void closeRound();
    if(step.primary==='release')void releaseResults();
  };

  const currentAttempts=selected?attempts.filter(a=>a.round_id===selected.id):[];
  const counts={
    active:currentAttempts.filter(a=>a.status==='active').length,
    submitted:currentAttempts.filter(a=>['completed','timed_out','recovered'].includes(a.status)).length,
    terminated:currentAttempts.filter(a=>a.status==='terminated').length,
  };

  return (
    <div className="shell">
      <header className="top">
        <div>
          <small>GERiCARE LIVE</small>
          <h1>Control</h1>
        </div>
        <div className={'badge'+(locked?' live':'')}>{locked?'● You have control':'○ View only'}</div>
      </header>

      <div className="wrap">
        <div className={'status-line'+(msgKind==='err'?' err':msgKind==='ok'?' ok':'')}>{message}</div>

        {/* What to do next */}
        <section className="next">
          <div className="label">Next step</div>
          <h2>{step.title}</h2>
          <p>{step.detail}</p>
          {step.blocked&&<p style={{marginTop:8,color:'#fca5a5'}}>{step.blocked}</p>}
          <div className="cta">
            {step.primary&&(
              <button type="button" className="btn primary" onClick={doPrimary}>{step.primaryLabel}</button>
            )}
            {locked&&selected&&selected.status==='open'&&(
              <button type="button" className="btn ghost" onClick={()=>void releaseResults()}>Release early (after close preferred)</button>
            )}
            {locked&&selected&&selected.status==='closed'&&step.primary!=='release'&&(
              <button type="button" className="btn ghost" onClick={()=>void releaseResults()}>Release results</button>
            )}
          </div>
        </section>

        {/* Rounds picker */}
        <section className="section">
          <h3>Rounds</h3>
          <div className="rounds">
            {rounds.map(r=>{
              const isOpen=r.status==='open';
              const isSel=selected?.id===r.id;
              return (
                <button
                  type="button"
                  key={r.id}
                  className={'round'+(isSel?' on':'')+(isOpen?' open-live':'')}
                  onClick={()=>setSelected(r)}
                >
                  <div className="rn">R{r.round_number}</div>
                  <div>
                    <strong>{r.title}</strong>
                    <div className="meta">
                      {r.status}
                      {r.questions_locked
                        ?<span className="tag ok">set ready</span>
                        :<span className="tag warn">no set</span>}
                      {isOpen&&<span className="tag live">live now</span>}
                    </div>
                  </div>
                </button>
              );
            })}
            {!rounds.length&&<p className="muted">No rounds</p>}
          </div>

          {selected&&locked&&(
            <div className="actions" style={{marginTop:12}}>
              <button type="button" className="btn" disabled={!selected.questions_locked||!!(openOther&&openOther.id!==selected.id)||selected.status==='open'} onClick={()=>void openRound()}>Open</button>
              <button type="button" className="btn" disabled={selected.status!=='open'} onClick={()=>void closeRound()}>Close</button>
              <button type="button" className="btn" disabled={selected.status!=='closed'&&selected.status!=='open'} onClick={()=>void releaseResults()}>Release</button>
            </div>
          )}
          {selected&&!locked&&(
            <div className="actions" style={{marginTop:12}}>
              <button type="button" className="btn primary" onClick={()=>void takeControl()}>Take control</button>
            </div>
          )}
        </section>

        {/* Live monitor for selected / open round */}
        <section className="section">
          <h3>This round · players</h3>
          <div className="stats">
            <div className="stat"><b>{counts.active}</b><span>Answering</span></div>
            <div className="stat"><b>{counts.submitted}</b><span>Submitted</span></div>
            <div className="stat"><b>{counts.terminated}</b><span>Flagged</span></div>
          </div>
          <div className="list">
            {currentAttempts.slice(0,8).map(a=>(
              <div className="row" key={a.id}>
                <span>{a.participant_id.slice(0,8)}…</span>
                <strong>{a.status}</strong>
                <span>{a.score} pts</span>
              </div>
            ))}
            {!currentAttempts.length&&<p className="muted">No attempts yet for this round.</p>}
          </div>
        </section>

        <section className="section">
          <h3>Projector</h3>
          <div className="actions">
            <button type="button" className="btn" onClick={()=>void present('WAITING')}>Waiting</button>
            <button type="button" className="btn" onClick={()=>void present('RULES',{p_title:'How to Play'})}>Rules</button>
            <button type="button" className="btn" onClick={()=>void present('ROUND_TOP10')}>Round top 10</button>
            <button type="button" className="btn" onClick={()=>void present('LEADERBOARD')}>Leaderboard</button>
            <button type="button" className="btn" onClick={()=>void present('FINAL',{p_title:'Grand Final'})}>Final screen</button>
            <button type="button" className="btn" onClick={()=>void present('WINNER')}>Winner</button>
          </div>
        </section>

        <section className="section">
          <h3>Leaderboard snapshot</h3>
          {board.length?
            <div className="list">
              {board.slice(0,10).map((b,i)=>(
                <div className="row" key={b.participant_id??i}>
                  <b>#{b.rank??i+1}</b>
                  <strong>{b.display_name??b.name}</strong>
                  <span>{b.score}</span>
                </div>
              ))}
            </div>
            :<p className="muted">Appears after you release results.</p>}
        </section>

        {/* Advanced folded away */}
        <details className="section">
          <summary>Grand Final & sudden death</summary>
          <div className="body">
            <div className="actions" style={{marginBottom:12}}>
              <button type="button" className="btn" onClick={()=>void run('Qualify finalists',()=>rpc('qualify_finalists',{p_event_id:eventId}))}>Qualify top 10</button>
              <button type="button" className="btn" onClick={()=>void run('Start final',async()=>{await rpc('start_final',{p_event_id:eventId});await present('FINAL',{p_title:'Grand Final'})})}>Start final</button>
              <button type="button" className="btn" onClick={()=>void run('Final board',()=>rpc('build_final_leaderboard',{p_event_id:eventId}))}>Final leaderboard</button>
              <button type="button" className="btn danger" onClick={()=>void run('Complete event',async()=>{await rpc('complete_event',{p_event_id:eventId});await present('WINNER')})}>Complete event</button>
            </div>
            <p className="muted">{finalists.length} finalists loaded</p>
            <div className="list" style={{marginBottom:12}}>
              {finalists.slice(0,10).map(f=>(
                <div className="row" key={f.id}>
                  <b>#{f.rank}</b>
                  <span>{f.participant_id.slice(0,8)}…</span>
                  <span>{f.preliminary_score}</span>
                </div>
              ))}
            </div>
            <h3 style={{margin:'12px 0 8px',fontSize:12,textTransform:'uppercase',color:'#64748b'}}>Sudden death</h3>
            <div className="actions">
              <input value={suddenQuestion} onChange={e=>setSuddenQuestion(e.target.value)} placeholder="Question UUID"/>
              <button type="button" className="btn" onClick={()=>void run('Sudden death',async()=>{
                if(!suddenQuestion.trim())throw Error('Paste question UUID');
                await rpc('start_sudden_death',{p_event_id:eventId,p_question_id:suddenQuestion.trim()});
                setSuddenQuestion('');
              })}>Start</button>
              <button type="button" className="btn" disabled={!sudden} onClick={()=>void run('Resolve SD',async()=>{
                if(!sudden)throw Error('None active');
                await rpc('resolve_sudden_death',{p_sudden_death_id:sudden.id});
              })}>Resolve</button>
            </div>
            {sudden&&<p className="muted" style={{marginTop:8}}>Active SD #{sudden.question_number}</p>}
          </div>
        </details>

        <details className="section">
          <summary>Integrity alerts</summary>
          <div className="body list">
            {integrity.slice(0,15).map(x=>(
              <div className="row" key={x.id}>
                <span>{new Date(x.occurred_at).toLocaleTimeString()}</span>
                <strong>{x.event}</strong>
                <span>{x.participant_id?.slice(0,8)??'—'}</span>
              </div>
            ))}
            {!integrity.length&&<p className="muted">None</p>}
          </div>
        </details>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
