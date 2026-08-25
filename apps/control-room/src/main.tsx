import React,{useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const supabase=url&&key?createClient(url,key):null;

const ALLOWED=new Set(['WAITING','RULES','QUESTION','ANSWER_REVEAL','EXPLANATION','ROUND_TOP10','LEADERBOARD','FINAL','WINNER']);

type Tab='rounds'|'projector'|'final';
type Round={id:string;event_id:string;round_number:number;title:string;status:string;questions_locked:boolean};
type Attempt={id:string;participant_id:string;round_id:string;status:string;score:number};
type Integrity={id:number;participant_id:string|null;event:string;occurred_at:string};
type Board={
  rank:number;
  participant_id?:string;
  display_name?:string;
  name?:string;
  score:number;
  total_score?:number;
  round_score?:number;
  prev_rank?:number|null;
  rank_delta?:number|null;
};
type Finalist={id:string;participant_id:string;preliminary_score:number;rank:number;status:string};
type Sudden={id:string;question_number:number;question_id:string};
type RQ={question_id:string;canonical_order:number;stem:string;explanation:string|null;options:{key:string;text:string;correct:boolean}[]};
type ShowOrder='teach'|'compete';
type ShowStep={id:string;kind:'waiting'|'rules'|'live'|'closed'|'recap'|'top10'|'overall';label:string;qIndex?:number};

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

function rowsFromPayload(payload:unknown):Record<string,unknown>[]{
  if(Array.isArray(payload))return payload as Record<string,unknown>[];
  if(payload&&typeof payload==='object'){
    const o=payload as Record<string,unknown>;
    if(Array.isArray(o.rows))return o.rows as Record<string,unknown>[];
    if(Array.isArray(o.leaderboard))return o.leaderboard as Record<string,unknown>[];
    if(Array.isArray(o.top10))return o.top10 as Record<string,unknown>[];
  }
  return [];
}

function normalizeBoard(rows:Board[]|Record<string,unknown>[]){
  return (rows??[]).map((b,i)=>{
    const r=b as Record<string,unknown>;
    const rank=Number(r.rank??i+1)||i+1;
    const name=String(r.display_name??r.name??'Participant').trim()||'Participant';
    const score=Number(r.score??r.total_score??0)||0;
    const total=Number(r.total_score??r.score??0)||0;
    const roundScore=r.round_score!=null?Number(r.round_score):undefined;
    const prev=r.prev_rank!=null?Number(r.prev_rank):null;
    const delta=r.rank_delta!=null?Number(r.rank_delta):(prev!=null?prev-rank:null);
    return{
      rank,
      name,
      display_name:name,
      score,
      total_score:total,
      round_score:roundScore,
      prev_rank:prev,
      rank_delta:delta,
      participant_id:r.participant_id!=null?String(r.participant_id):undefined,
    } as Board;
  });
}

/** Enrich board with round_score, total_score, prev_rank, rank_delta for projector */
function enrichBoard(
  base:Board[],
  attempts:Attempt[],
  roundId:string|null|undefined,
  prevRankByParticipant:Map<string,number>,
):Board[]{
  const roundScoreByP=new Map<string,number>();
  const totalByP=new Map<string,number>();
  for(const a of attempts){
    const s=Number(a.score)||0;
    totalByP.set(a.participant_id,(totalByP.get(a.participant_id)??0)+s);
    if(roundId&&a.round_id===roundId){
      roundScoreByP.set(a.participant_id,Math.max(roundScoreByP.get(a.participant_id)??0,s));
    }
  }
  return base.map((b,i)=>{
    const pid=b.participant_id;
    const rank=b.rank||i+1;
    const total=pid&&totalByP.has(pid)?totalByP.get(pid)!:(b.total_score??b.score??0);
    const round_score=pid&&roundId?(roundScoreByP.get(pid)??0):(b.round_score??undefined);
    const prev_rank=pid&&prevRankByParticipant.has(pid)?prevRankByParticipant.get(pid)!:(b.prev_rank??null);
    const rank_delta=prev_rank!=null?prev_rank-rank:null;
    return{
      ...b,
      rank,
      score:total,
      total_score:total,
      round_score,
      prev_rank,
      rank_delta,
      display_name:b.display_name??b.name,
      name:b.name??b.display_name,
    };
  });
}

async function rpc(name:string,args:Record<string,unknown>={}){
  if(!supabase)throw Error('Supabase not configured');
  const{data,error}=await supabase.rpc(name,args);
  if(error)throw error;
  return data;
}

function nextStep(r:Round|null,locked:boolean,openOther:Round|undefined){
  if(!r)return{title:'Select a round',detail:'Tap a round below.',primary:undefined as undefined,primaryLabel:undefined as undefined,blocked:undefined as string|undefined};
  if(!locked)return{title:'Take control first',detail:'Required before open/close/release.',primary:'control' as const,primaryLabel:'Take control',blocked:undefined};
  if(!r.questions_locked)return{title:'Questions not frozen',detail:'Admin must lock 3 questions for this round.',primary:undefined,primaryLabel:undefined,blocked:'Admin → freeze set'};
  if(openOther&&openOther.id!==r.id)return{title:`Close R${openOther.round_number} first`,detail:'Only one open round.',primary:undefined,primaryLabel:undefined,blocked:`Select R${openOther.round_number} → Close`};
  if(r.status==='draft'||r.status==='locked')return{title:`Open Round ${r.round_number}`,detail:'Participants can answer; projector can follow.',primary:'open' as const,primaryLabel:'Open round',blocked:undefined};
  if(r.status==='open')return{title:`Close Round ${r.round_number}`,detail:'Then use Projector tab for Q&A / scores show.',primary:'close' as const,primaryLabel:'Close round',blocked:undefined};
  if(r.status==='closed')return{title:'Release results',detail:'Builds leaderboard (see list below).',primary:'release' as const,primaryLabel:'Release results',blocked:undefined};
  return{title:`Round ${r.round_number} done`,detail:'Select next round or open Final tab.',primary:undefined,primaryLabel:undefined,blocked:undefined};
}

function buildPostCloseSteps(order:ShowOrder,qCount:number):ShowStep[]{
  const recaps:ShowStep[]=Array.from({length:qCount},(_,i)=>({id:`recap-${i}`,kind:'recap' as const,label:`Q&A ${i+1}/${qCount}`,qIndex:i}));
  const top:ShowStep={id:'top10',kind:'top10',label:'Round top 10'};
  const overall:ShowStep={id:'overall',kind:'overall',label:'Overall board'};
  if(order==='teach')return[{id:'closed',kind:'closed',label:'Round closed'},...recaps,top,overall];
  return[{id:'closed',kind:'closed',label:'Round closed'},top,...recaps,overall];
}

function movementLabel(delta:number|null|undefined,prev:number|null|undefined){
  if(prev==null&&(delta==null))return 'NEW';
  if(delta==null)return '—';
  if(delta===0)return '—';
  if(delta>0)return `▲${delta}`;
  return `▼${Math.abs(delta)}`;
}

function App(){
  const[tab,setTab]=useState<Tab>('rounds');
  const[eventId,setEventId]=useState('');
  const[rounds,setRounds]=useState<Round[]>([]);
  const[attempts,setAttempts]=useState<Attempt[]>([]);
  const[integrity,setIntegrity]=useState<Integrity[]>([]);
  const[board,setBoard]=useState<Board[]>([]);
  const[prevRanks,setPrevRanks]=useState<Map<string,number>>(new Map());
  const[finalists,setFinalists]=useState<Finalist[]>([]);
  const[sudden,setSudden]=useState<Sudden|null>(null);
  const[suddenQuestion,setSuddenQuestion]=useState('');
  const[selected,setSelected]=useState<Round|null>(null);
  const[message,setMessage]=useState('Ready');
  const[msgKind,setMsgKind]=useState<'ok'|'err'|'info'>('info');
  const[locked,setLocked]=useState(false);
  const lockEventRef=useRef<string|null>(null);

  const[showOrder,setShowOrder]=useState<ShowOrder>('teach');
  const[autoFollow,setAutoFollow]=useState(true);
  const[qaSeconds,setQaSeconds]=useState(12);
  const[paused,setPaused]=useState(false);
  const[roundQs,setRoundQs]=useState<RQ[]>([]);
  const[playlist,setPlaylist]=useState<ShowStep[]>([]);
  const[playIdx,setPlayIdx]=useState(0);
  const timerRef=useRef<number|null>(null);
  const boardRef=useRef<Board[]>([]);
  const attemptsRef=useRef<Attempt[]>([]);
  const prevRanksRef=useRef<Map<string,number>>(new Map());
  boardRef.current=board;
  attemptsRef.current=attempts;
  prevRanksRef.current=prevRanks;

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

  const loadRoundQuestions=async(roundId:string)=>{
    if(!supabase)return [] as RQ[];
    const{data:rq,error}=await supabase.from('round_questions').select('question_id,canonical_order').eq('round_id',roundId).order('canonical_order');
    if(error)throw error;
    const rows=rq??[];
    if(!rows.length){setRoundQs([]);return []}
    const ids=rows.map(r=>r.question_id);
    const[{data:qs},{data:opts}]=await Promise.all([
      supabase.from('questions').select('id,stem,explanation').in('id',ids),
      supabase.from('question_options').select('question_id,option_key,option_text,is_correct').in('question_id',ids).order('option_key'),
    ]);
    const qmap=new Map((qs??[]).map(x=>[x.id,x]));
    const byQ=new Map<string,{key:string;text:string;correct:boolean}[]>();
    for(const o of opts??[]){
      const list=byQ.get(o.question_id)??[];
      list.push({key:o.option_key,text:o.option_text,correct:!!o.is_correct});
      byQ.set(o.question_id,list);
    }
    const built=rows.map(r=>{
      const q=qmap.get(r.question_id);
      return{question_id:r.question_id,canonical_order:r.canonical_order,stem:q?.stem??'(missing)',explanation:q?.explanation??null,options:byQ.get(r.question_id)??[]};
    });
    setRoundQs(built);
    return built;
  };

  const load=async()=>{
    if(!supabase){setMessage('Configure Supabase');setMsgKind('err');return}
    try{
      const eid=await resolveEvent();
      const [{data:r,error:re},{data:a,error:ae},{data:i,error:ie},{data:snaps,error:se},{data:f,error:fe},{data:sd,error:sde}]=await Promise.all([
        supabase.from('rounds').select('id,event_id,round_number,title,status,questions_locked').eq('event_id',eid).order('round_number'),
        supabase.from('attempts').select('id,participant_id,round_id,status,score').eq('event_id',eid).order('started_at',{ascending:false}).limit(2000),
        supabase.from('integrity_events').select('id,participant_id,event,occurred_at').eq('event_id',eid).order('occurred_at',{ascending:false}).limit(50),
        supabase.from('leaderboard_snapshots').select('payload,created_at').eq('event_id',eid).order('created_at',{ascending:false}).limit(2),
        supabase.from('finalists').select('id,participant_id,preliminary_score,rank,status').eq('event_id',eid).order('rank'),
        supabase.from('sudden_death_attempts').select('id,question_number,question_id').eq('event_id',eid).order('question_number',{ascending:false}).limit(1).maybeSingle(),
      ]);
      if(re||ae||ie||se||fe||sde)throw(re||ae||ie||se||fe||sde);
      setRounds(r??[]);setAttempts(a??[]);setIntegrity(i??[]);setFinalists(f??[]);setSudden(sd??null);

      const snapList=snaps??[];
      const currentRows=rowsFromPayload(snapList[0]?.payload);
      const prevRows=rowsFromPayload(snapList[1]?.payload);
      const prevMap=new Map<string,number>();
      for(const row of prevRows){
        const pid=row.participant_id!=null?String(row.participant_id):'';
        if(pid)prevMap.set(pid,Number(row.rank)||0);
      }
      setPrevRanks(prevMap);

      const base=normalizeBoard(currentRows);
      const enriched=enrichBoard(base,a??[],null,prevMap);
      setBoard(enriched);

      setSelected(prev=>{
        if(prev){const u=(r??[]).find(x=>x.id===prev.id);if(u)return u}
        return (r??[]).find(x=>x.status==='open')??(r??[])[0]??null;
      });
    }catch(e){setMessage(errText(e));setMsgKind('err')}
  };

  useEffect(()=>{void load();if(!supabase)return;
    const ch=supabase.channel('control-room-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'rounds'},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'attempts'},()=>void load())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'integrity_events'},()=>void load())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'leaderboard_snapshots'},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'finalists'},()=>void load())
      .subscribe();
    return()=>{supabase.removeChannel(ch)};
  },[eventId]);

  useEffect(()=>{
    if(!locked||!lockEventRef.current)return;
    const eid=lockEventRef.current;
    const id=window.setInterval(()=>{void rpc('acquire_control_lock',{p_event_id:eid}).catch(()=>{})},12_000);
    return()=>window.clearInterval(id);
  },[locked]);

  useEffect(()=>{if(selected)void loadRoundQuestions(selected.id).catch(e=>{setMessage(errText(e));setMsgKind('err')})},[selected?.id]);

  const boardForPublish=(roundId?:string|null)=>{
    return enrichBoard(boardRef.current,attemptsRef.current,roundId??selected?.id,prevRanksRef.current);
  };

  const publish=useCallback(async(state:string,payload:Record<string,unknown>={})=>{
    if(!eventId)return;
    if(!ALLOWED.has(state))throw Error(`Invalid presentation state: ${state}`);
    await rpc('publish_presentation_state',{
      p_event_id:eventId,p_state:state,p_round_id:selected?.id??null,
      p_title:null,p_question:null,p_options:[],p_answer:null,p_explanation:null,p_top10:[],p_media:[],
      ...payload,
    });
  },[eventId,selected?.id]);

  const publishStep=useCallback(async(step:ShowStep,r:Round|null,qs:RQ[])=>{
    if(step.kind==='live'&&r){
      await publish('QUESTION',{p_round_id:r.id,p_title:`Round ${r.round_number}`,p_question:`Round ${r.round_number} — ${r.title}\n\nAnswer on your devices now`,p_options:[]});
      return;
    }
    if(step.kind==='closed'&&r){
      await publish('WAITING',{p_round_id:r.id,p_title:`Round ${r.round_number} closed`});
      return;
    }
    if(step.kind==='recap'&&r){
      const q=qs[step.qIndex??0];
      if(!q)throw Error('No question for recap — lock set in Admin');
      const correct=q.options.find(o=>o.correct);
      await publish('ANSWER_REVEAL',{
        p_round_id:r.id,p_title:`Round ${r.round_number} · Q${(step.qIndex??0)+1}`,
        p_question:q.stem,
        p_options:q.options.map(o=>({key:o.key,text:o.text,correct:o.correct})),
        p_answer:correct?`${correct.key}. ${correct.text}`:null,
        p_explanation:q.explanation,
      });
      return;
    }
    if(step.kind==='top10'&&r){
      const rows=boardForPublish(r.id);
      await publish('ROUND_TOP10',{p_round_id:r.id,p_title:`Round ${r.round_number} · Top 10`,p_top10:rows});
      return;
    }
    if(step.kind==='overall'){
      const rows=boardForPublish(null);
      await publish('LEADERBOARD',{p_title:'Overall leaderboard',p_top10:rows});
      return;
    }
    if(step.kind==='waiting')await publish('WAITING',{p_title:'GERiCARE Conference Quiz'});
    if(step.kind==='rules')await publish('RULES',{p_title:'How to Play'});
  },[publish]);

  const clearTimer=()=>{if(timerRef.current){window.clearTimeout(timerRef.current);timerRef.current=null}};

  const goToIndex=useCallback(async(idx:number,list:ShowStep[],r:Round|null,qs:RQ[])=>{
    if(!list.length||idx<0||idx>=list.length)return;
    setPlayIdx(idx);
    setMessage(`Projector: ${list[idx].label}`);setMsgKind('info');
    try{await publishStep(list[idx],r,qs);setMsgKind('ok')}
    catch(e){setMessage(errText(e));setMsgKind('err')}
  },[publishStep]);

  useEffect(()=>{
    clearTimer();
    if(paused||!playlist.length)return;
    const s=playlist[playIdx];
    if(!s||s.kind!=='recap')return;
    timerRef.current=window.setTimeout(()=>{if(playIdx<playlist.length-1)void goToIndex(playIdx+1,playlist,selected,roundQs)},Math.max(5,qaSeconds)*1000);
    return clearTimer;
  },[playIdx,playlist,paused,qaSeconds,selected,roundQs,goToIndex]);

  const run=async(label:string,fn:()=>Promise<unknown>)=>{
    try{setMessage(label+'…');setMsgKind('info');await fn();setMessage(label+' — done');setMsgKind('ok');await load()}
    catch(e){setMessage(errText(e));setMsgKind('err')}
  };

  const takeControl=()=>selected&&run('Take control',async()=>{
    await rpc('acquire_control_lock',{p_event_id:selected.event_id});
    lockEventRef.current=selected.event_id;setLocked(true);
  });

  const openRound=()=>selected&&run('Open round',async()=>{
    const other=rounds.find(x=>x.status==='open'&&x.id!==selected.id);
    if(other)throw Error(`Close Round ${other.round_number} first`);
    if(!selected.questions_locked)throw Error('Freeze 3 questions in Admin first');
    await rpc('open_round',{p_event_id:selected.event_id,p_round_id:selected.id});
    if(autoFollow){
      const live:ShowStep={id:'live',kind:'live',label:`R${selected.round_number} live`};
      setPlaylist([live]);setPlayIdx(0);
      await publishStep(live,selected,roundQs);
      setTab('projector');
    }
  });

  const closeRound=()=>selected&&run('Close round',async()=>{
    await rpc('close_round',{p_event_id:selected.event_id,p_round_id:selected.id});
    if(autoFollow){
      const qs=await loadRoundQuestions(selected.id);
      const steps=buildPostCloseSteps(showOrder,qs.length||3);
      setPlaylist(steps);setPlayIdx(0);setPaused(false);
      await publishStep(steps[0],selected,qs);
      setTab('projector');
    }
  });

  const releaseResults=()=>selected&&run('Release results',async()=>{
    await rpc('release_round_results',{p_event_id:selected.event_id,p_round_id:selected.id});
    await rpc('build_round_top10',{p_event_id:selected.event_id,p_round_id:selected.id});
    await rpc('build_overall_leaderboard',{p_event_id:selected.event_id});
    await load();
    if(autoFollow){
      let list=playlist;
      if(!list.length){
        const qs=roundQs.length?roundQs:await loadRoundQuestions(selected.id);
        list=buildPostCloseSteps(showOrder,qs.length||3);
        setPlaylist(list);
      }
      const scoreIdx=list.findIndex(s=>s.kind==='top10');
      if(scoreIdx>=0){await goToIndex(scoreIdx,list,selected,roundQs);setTab('projector')}
      else{
        const rows=boardForPublish(selected.id);
        await publish('ROUND_TOP10',{p_title:`Round ${selected.round_number} · Top 10`,p_top10:rows});
      }
    }
  });

  const openOther=rounds.find(r=>r.status==='open');
  const step=nextStep(selected,locked,openOther&&selected&&openOther.id!==selected.id?openOther:undefined);
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

  const displayBoard=selected?enrichBoard(board,attempts,selected.id,prevRanks):board;

  const presentManual=(state:string,payload:Record<string,unknown>={})=>
    run(`Projector → ${state}`,()=>publish(state,payload));

  return (
    <div className="shell">
      <header className="top">
        <div className="top-row">
          <div><small>GERiCARE LIVE</small><h1>Control</h1></div>
          <div className={'badge'+(locked?' live':'')}>{locked?'● You have control':'○ View only'}</div>
        </div>
        <nav className="tabs">
          <button type="button" className={'tab'+(tab==='rounds'?' on':'')} onClick={()=>setTab('rounds')}>Rounds</button>
          <button type="button" className={'tab'+(tab==='projector'?' on':'')} onClick={()=>setTab('projector')}>Projector</button>
          <button type="button" className={'tab'+(tab==='final'?' on':'')} onClick={()=>setTab('final')}>Final</button>
        </nav>
      </header>

      <div className="wrap">
        <div className={'status-line'+(msgKind==='err'?' err':msgKind==='ok'?' ok':'')}>{message}</div>

        {tab==='rounds'&&(
          <>
            <section className="next">
              <div className="label">Next step</div>
              <h2>{step.title}</h2>
              <p>{step.detail}</p>
              {step.blocked&&<p style={{marginTop:8,color:'#fca5a5'}}>{step.blocked}</p>}
              <div className="cta">{step.primary&&<button type="button" className="btn primary" onClick={doPrimary}>{step.primaryLabel}</button>}</div>
            </section>

            <section className="section">
              <h3>Rounds</h3>
              <div className="rounds">
                {rounds.map(r=>(
                  <button type="button" key={r.id} className={'round'+(selected?.id===r.id?' on':'')+(r.status==='open'?' open-live':'')} onClick={()=>setSelected(r)}>
                    <div className="rn">R{r.round_number}</div>
                    <div>
                      <strong>{r.title}</strong>
                      <div className="meta">{r.status}{r.questions_locked?<span className="tag ok">set ready</span>:<span className="tag warn">no set</span>}{r.status==='open'&&<span className="tag live">live</span>}</div>
                    </div>
                  </button>
                ))}
              </div>
              {selected&&(
                <div className="actions" style={{marginTop:12}}>
                  {!locked&&<button type="button" className="btn primary" onClick={()=>void takeControl()}>Take control</button>}
                  {locked&&(
                    <>
                      <button type="button" className="btn" disabled={!selected.questions_locked||!!(openOther&&openOther.id!==selected.id)||selected.status==='open'} onClick={()=>void openRound()}>Open</button>
                      <button type="button" className="btn" disabled={selected.status!=='open'} onClick={()=>void closeRound()}>Close</button>
                      <button type="button" className="btn" disabled={selected.status!=='closed'&&selected.status!=='open'} onClick={()=>void releaseResults()}>Release</button>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className="section">
              <h3>This round · players</h3>
              <div className="stats">
                <div className="stat"><b>{counts.active}</b><span>Answering</span></div>
                <div className="stat"><b>{counts.submitted}</b><span>Submitted</span></div>
                <div className="stat"><b>{counts.terminated}</b><span>Flagged</span></div>
              </div>
            </section>

            <section className="section">
              <h3>Leaderboard</h3>
              <p className="muted" style={{marginBottom:8}}>▲▼ vs previous overall · Round = this round · Total = cumulative</p>
              {displayBoard.length?(
                <div className="list">
                  <div className="row" style={{fontWeight:800,color:'#64748b',fontSize:11}}>
                    <span># · move</span><span>Name</span><span>Rnd / Tot</span>
                  </div>
                  {displayBoard.slice(0,10).map((b,i)=>(
                    <div className="row" key={b.participant_id??i}>
                      <b>#{b.rank} <span style={{color:b.rank_delta&&b.rank_delta>0?'#16a34a':b.rank_delta&&b.rank_delta<0?'#dc2626':'#94a3b8',fontWeight:700}}>{movementLabel(b.rank_delta,b.prev_rank)}</span></b>
                      <strong>{b.display_name??b.name}</strong>
                      <span>{b.round_score!=null?b.round_score:'—'} / {b.total_score??b.score}</span>
                    </div>
                  ))}
                </div>
              ):<p className="muted">Appears after you release results.</p>}
            </section>

            <section className="section">
              <h3>Integrity</h3>
              <div className="list">
                {integrity.slice(0,12).map(x=>(
                  <div className="row" key={x.id}>
                    <span>{new Date(x.occurred_at).toLocaleTimeString()}</span>
                    <strong>{x.event}</strong>
                    <span>{x.participant_id?.slice(0,8)??'—'}</span>
                  </div>
                ))}
                {!integrity.length&&<p className="muted">No flags</p>}
              </div>
            </section>
          </>
        )}

        {tab==='projector'&&(
          <>
            <section className="section">
              <h3>Show settings</h3>
              <div className="actions" style={{marginBottom:10}}>
                <label style={{fontSize:12,fontWeight:700,display:'flex',alignItems:'center',gap:6}}>
                  <input type="checkbox" checked={autoFollow} onChange={e=>setAutoFollow(e.target.checked)}/> Auto-follow Open / Close / Release
                </label>
              </div>
              <div className="actions" style={{marginBottom:10}}>
                <button type="button" className={'btn'+(showOrder==='teach'?' primary':'')} onClick={()=>setShowOrder('teach')}>Teach: Q&A → scores</button>
                <button type="button" className={'btn'+(showOrder==='compete'?' primary':'')} onClick={()=>setShowOrder('compete')}>Compete: scores → Q&A</button>
              </div>
              <div className="actions">
                <label style={{fontSize:12}}>Q&A seconds
                  <input type="number" min={5} max={60} value={qaSeconds} onChange={e=>setQaSeconds(+e.target.value||12)} style={{width:64,marginLeft:8}}/>
                </label>
              </div>
            </section>

            <section className="section">
              <h3>Playlist</h3>
              {playlist.length?(
                <>
                  <p className="muted" style={{marginBottom:8}}>Now: <b>{playlist[playIdx]?.label??'—'}</b> ({playIdx+1}/{playlist.length}){paused?' · paused':''}</p>
                  <div className="actions" style={{marginBottom:10}}>
                    <button type="button" className="btn" disabled={playIdx<=0} onClick={()=>void goToIndex(playIdx-1,playlist,selected,roundQs)}>◀ Back</button>
                    <button type="button" className="btn" onClick={()=>setPaused(p=>!p)}>{paused?'Resume':'Pause'}</button>
                    <button type="button" className="btn primary" disabled={playIdx>=playlist.length-1} onClick={()=>void goToIndex(playIdx+1,playlist,selected,roundQs)}>Next ▶</button>
                  </div>
                  <div className="list">
                    {playlist.map((s,i)=>(
                      <button type="button" key={s.id} className={'play-row'+(i===playIdx?' on':'')} onClick={()=>void goToIndex(i,playlist,selected,roundQs)}>
                        <span>{i===playIdx?'→':'·'}</span><strong>{s.label}</strong><span className="muted">{s.kind}</span>
                      </button>
                    ))}
                  </div>
                </>
              ):(
                <p className="muted">No active sequence. Close a round (with auto-follow) or start one below.</p>
              )}
              {selected&&selected.questions_locked&&(
                <div className="actions" style={{marginTop:12}}>
                  <button type="button" className="btn primary" onClick={()=>void run('Start sequence',async()=>{
                    const qs=await loadRoundQuestions(selected.id);
                    const steps=buildPostCloseSteps(showOrder,qs.length||3);
                    setPlaylist(steps);setPlayIdx(0);setPaused(false);
                    await goToIndex(0,steps,selected,qs);
                  })}>Start Q&A / scores sequence</button>
                </div>
              )}
            </section>

            <section className="section">
              <h3>Jump to screen</h3>
              <div className="actions">
                <button type="button" className="btn" onClick={()=>void presentManual('WAITING',{p_title:'GERiCARE Conference Quiz'})}>Waiting</button>
                <button type="button" className="btn" onClick={()=>void presentManual('RULES',{p_title:'How to Play'})}>Rules</button>
                <button type="button" className="btn" onClick={()=>void presentManual('ROUND_TOP10',{p_title:selected?`Round ${selected.round_number} · Top 10`:'Top 10',p_top10:boardForPublish(selected?.id)})}>Round top 10</button>
                <button type="button" className="btn" onClick={()=>void presentManual('LEADERBOARD',{p_title:'Overall',p_top10:boardForPublish(null)})}>Overall</button>
                <button type="button" className="btn" onClick={()=>void presentManual('FINAL',{p_title:'Grand Final'})}>Final</button>
                <button type="button" className="btn" onClick={()=>void presentManual('WINNER')}>Winner</button>
              </div>
            </section>
          </>
        )}

        {tab==='final'&&(
          <>
            <section className="section">
              <h3>Grand Final</h3>
              <div className="actions">
                <button type="button" className="btn" onClick={()=>void run('Qualify',()=>rpc('qualify_finalists',{p_event_id:eventId}))}>Qualify top 10</button>
                <button type="button" className="btn primary" onClick={()=>void run('Start final',async()=>{await rpc('start_final',{p_event_id:eventId});await publish('FINAL',{p_title:'Grand Final'})})}>Start final</button>
                <button type="button" className="btn" onClick={()=>void run('Final board',()=>rpc('build_final_leaderboard',{p_event_id:eventId}))}>Final leaderboard</button>
                <button type="button" className="btn danger" onClick={()=>void run('Complete event',async()=>{await rpc('complete_event',{p_event_id:eventId});await publish('WINNER')})}>Complete event</button>
              </div>
              <p className="muted" style={{marginTop:12}}>{finalists.length} finalists</p>
            </section>
            <section className="section">
              <h3>Sudden death</h3>
              <div className="actions">
                <input value={suddenQuestion} onChange={e=>setSuddenQuestion(e.target.value)} placeholder="Question UUID"/>
                <button type="button" className="btn" onClick={()=>void run('Start SD',async()=>{
                  if(!suddenQuestion.trim())throw Error('Paste question UUID');
                  await rpc('start_sudden_death',{p_event_id:eventId,p_question_id:suddenQuestion.trim()});
                  setSuddenQuestion('');
                })}>Start</button>
                <button type="button" className="btn" disabled={!sudden} onClick={()=>void run('Resolve SD',async()=>{
                  if(!sudden)throw Error('None active');
                  await rpc('resolve_sudden_death',{p_sudden_death_id:sudden.id});
                })}>Resolve</button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
