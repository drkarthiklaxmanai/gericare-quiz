import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const sb=url&&key?createClient(url,key):null;

type Q={id:string;event_id:string;category_id:string|null;stem:string;status:string;difficulty:number;points:number;explanation:string|null;reference_text:string|null;created_at:string};
type R={id:string;event_id:string;round_number:number;title:string;status:string;questions_locked:boolean};
type C={id:string;name:string;slug:string};
type O={option_key:string;option_text:string;is_correct:boolean};
type FQ={question_id:string;canonical_order:number};
type RQ={round_id:string;question_id:string;canonical_order:number};
type Tab='organize'|'bank'|'final';
type Form={stem:string;category:string;difficulty:number;points:number;options:string[];correct:number;explanation:string};
type DragPayload={questionId:string;from:'pool'|string;fromOrder?:number}; // from = 'pool' or roundId

const emptyForm=():Form=>({stem:'',category:'',difficulty:3,points:10,options:['','','',''],correct:0,explanation:''});
const slug=(x:string)=>x.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

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

async function rpc(n:string,a:Record<string,unknown>={}){
  if(!sb)throw Error('Supabase not configured');
  const{data,error}=await sb.rpc(n,a);
  if(error)throw error;
  return data;
}

function App(){
  const[tab,setTab]=useState<Tab>('organize');
  const[eventId,setEventId]=useState(configuredEvent??'');
  const[q,setQ]=useState<Q[]>([]);
  const[rounds,setRounds]=useState<R[]>([]);
  const[cats,setCats]=useState<C[]>([]);
  const[allRQ,setAllRQ]=useState<RQ[]>([]);
  const[sel,setSel]=useState<Q|null>(null);
  const[selOpts,setSelOpts]=useState<O[]>([]);
  const[search,setSearch]=useState('');
  const[filter,setFilter]=useState<'all'|'draft'|'approved'>('all');
  const[finalQ,setFinalQ]=useState<FQ[]>([]);
  const[status,setStatus]=useState('Ready');
  const[modal,setModal]=useState<'create'|'edit'|null>(null);
  const[form,setForm]=useState<Form>(emptyForm());
  const[aiTopic,setAiTopic]=useState('');
  const[busy,setBusy]=useState(false);
  const[dragOver,setDragOver]=useState<string|null>(null); // `${roundId}:${order}` or 'pool'
  const[draggingId,setDraggingId]=useState<string|null>(null);

  const resolveEvent=async()=>{
    if(configuredEvent){setEventId(configuredEvent);return configuredEvent}
    if(!sb)return '';
    const{data,error}=await sb.from('events').select('id').limit(1).maybeSingle();
    if(error)throw error;
    if(!data)throw Error('No accessible event');
    setEventId(data.id);
    return data.id;
  };

  const load=async(id?:string)=>{
    if(!sb){setStatus('Configure Supabase environment');return}
    try{
      const eid=id||eventId||await resolveEvent();
      if(!eid)return;
      const roundsRes=await sb.from('rounds').select('id,event_id,round_number,title,status,questions_locked').eq('event_id',eid).order('round_number');
      if(roundsRes.error)throw roundsRes.error;
      const rlist=roundsRes.data??[];
      const roundIds=rlist.map(r=>r.id);
      const[a,c,d,rq]=await Promise.all([
        sb.from('questions').select('id,event_id,category_id,stem,status,difficulty,points,explanation,reference_text,created_at').eq('event_id',eid).order('created_at',{ascending:false}),
        sb.from('categories').select('id,name,slug').eq('event_id',eid).order('name'),
        sb.from('final_questions').select('question_id,canonical_order').eq('event_id',eid).order('canonical_order'),
        roundIds.length?sb.from('round_questions').select('round_id,question_id,canonical_order').in('round_id',roundIds):Promise.resolve({data:[],error:null}),
      ]);
      if(a.error||c.error||d.error||rq.error)throw(a.error||c.error||d.error||rq.error);
      setQ(a.data??[]);setRounds(rlist);setCats(c.data??[]);setFinalQ(d.data??[]);setAllRQ((rq.data??[]) as RQ[]);
    }catch(e){setStatus(errText(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(errText(e)))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';

  const byRound=useMemo(()=>{
    const m=new Map<string,Map<number,string>>(); // roundId -> order -> questionId
    for(const r of rounds)m.set(r.id,new Map());
    for(const row of allRQ){
      const mm=m.get(row.round_id);
      if(mm)mm.set(row.canonical_order,row.question_id);
    }
    return m;
  },[rounds,allRQ]);

  const assignedIds=useMemo(()=>new Set(allRQ.map(r=>r.question_id)),[allRQ]);
  const finalIds=useMemo(()=>new Set(finalQ.map(f=>f.question_id)),[finalQ]);

  const pool=useMemo(()=>q.filter(x=>x.status==='approved'&&!assignedIds.has(x.id)&&!finalIds.has(x.id)),[q,assignedIds,finalIds]);

  const filteredBank=useMemo(()=>{
    return q.filter(x=>{
      if(filter!=='all'&&x.status!==filter)return false;
      return (x.stem+' '+categoryName(x.category_id)).toLowerCase().includes(search.toLowerCase());
    });
  },[q,cats,search,filter]);

  const loadQuestion=async(x:Q)=>{
    if(sel?.id===x.id){setSel(null);setSelOpts([]);return}
    setSel(x);
    if(!sb)return;
    const{data,error}=await sb.from('question_options').select('option_key,option_text,is_correct').eq('question_id',x.id).order('option_key');
    if(error){setStatus(errText(error));setSelOpts([]);return}
    setSelOpts(data??[]);
  };

  const openEdit=(x:Q,opts:O[])=>{
    const ordered=['A','B','C','D'].map(k=>opts.find(o=>o.option_key===k)?.option_text??'');
    const correct=Math.max(0,opts.findIndex(o=>o.is_correct));
    setForm({stem:x.stem,category:categoryName(x.category_id)==='Uncategorised'?'':categoryName(x.category_id),difficulty:x.difficulty,points:x.points,options:ordered.length===4?ordered:[ordered[0]||'',ordered[1]||'',ordered[2]||'',ordered[3]||''],correct:correct>=0?correct:0,explanation:x.explanation??''});
    setModal('edit');
  };

  const openCreate=()=>{setForm(emptyForm());setAiTopic('');setModal('create')};

  const ensureCategory=async(name:string)=>{
    if(!name.trim()||!sb)return null;
    const found=cats.find(c=>c.name.toLowerCase()===name.trim().toLowerCase());
    if(found)return found.id;
    const{data,error}=await sb.from('categories').insert({event_id:eventId,name:name.trim(),slug:slug(name)}).select('id,name,slug').single();
    if(error)throw error;
    setCats(v=>[...v,data]);
    return data.id;
  };

  const saveCreate=async()=>{
    try{
      if(!sb||!eventId)throw Error('Event not configured');
      if(!form.stem.trim()||form.options.some(x=>!x.trim()))throw Error('Stem and all four options required');
      setBusy(true);setStatus('Saving…');
      const category_id=await ensureCategory(form.category);
      const{data:user}=await sb.auth.getUser();
      const{data:x,error}=await sb.from('questions').insert({event_id:eventId,category_id,stem:form.stem.trim(),status:'draft',difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null,created_by:user.user?.id??null,ai_metadata:aiTopic?{generated:true,topic:aiTopic}:{}}).select('id').single();
      if(error)throw error;
      const{error:oe}=await sb.from('question_options').insert(form.options.map((t,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text:t.trim(),is_correct:i===form.correct})));
      if(oe)throw oe;
      setModal(null);setStatus('Draft saved');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const saveEdit=async()=>{
    if(!sel||!sb)return;
    try{
      if(!form.stem.trim()||form.options.some(x=>!x.trim()))throw Error('Stem and all four options required');
      setBusy(true);setStatus('Saving…');
      const category_id=await ensureCategory(form.category);
      const{error}=await sb.from('questions').update({stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null}).eq('id',sel.id);
      if(error)throw error;
      await sb.from('question_options').delete().eq('question_id',sel.id);
      const{error:oe}=await sb.from('question_options').insert(form.options.map((t,i)=>({question_id:sel.id,option_key:String.fromCharCode(65+i),option_text:t.trim(),is_correct:i===form.correct})));
      if(oe)throw oe;
      setModal(null);setStatus('Updated');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const generate=async()=>{
    try{
      if(!aiTopic.trim())throw Error('Enter a topic');
      setBusy(true);
      const{data,error}=await sb!.functions.invoke('question-ai',{body:{action:'generate',event_id:eventId,topic:aiTopic,difficulty:form.difficulty,category:form.category||undefined}});
      if(error)throw error;
      if(data?.error)throw Error(data.message||data.detail||data.error);
      const d=data.draft;
      setForm({stem:d.stem,category:d.category??form.category,difficulty:d.difficulty??form.difficulty,points:10,options:Array.isArray(d.options)?d.options:form.options,correct:typeof d.correct_index==='number'?d.correct_index:0,explanation:d.explanation??''});
      setStatus('AI draft ready');
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const approve=async()=>{
    if(!sel||!sb)return;
    try{
      setBusy(true);
      const correct=selOpts.findIndex(o=>o.is_correct);
      const{data:qa,error:qe}=await sb.functions.invoke('question-ai',{body:{action:'qa',event_id:eventId,stem:sel.stem,options:selOpts.map(o=>o.option_text),correct_index:correct,explanation:sel.explanation??'',difficulty:sel.difficulty,category:categoryName(sel.category_id)}});
      if(qe)throw qe;
      if(!qa?.pass)throw Error('QA failed: '+(qa?.flags??[]).map((f:any)=>f.message).join(' '));
      const{data:user}=await sb.auth.getUser();
      const{error}=await sb.from('questions').update({status:'approved',approved_by:user.user?.id??null,approved_at:new Date().toISOString()}).eq('id',sel.id);
      if(error)throw error;
      setStatus('Approved');await load(eventId);setSel({...sel,status:'approved'});
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  /** Rebuild a round's assignments to match desired order of question ids (length ≤ 3). */
  const setRoundQuestions=async(round:R,orderedIds:string[])=>{
    if(round.questions_locked)throw Error('Round is locked — Unlock first');
    if(orderedIds.length>3)throw Error('Max 3 questions per round');
    // Remove all current, then re-add in order (simple + reliable with existing RPCs)
    const current=allRQ.filter(r=>r.round_id===round.id);
    for(const row of current){
      await rpc('remove_question_from_round',{p_round_id:round.id,p_question_id:row.question_id});
    }
    for(let i=0;i<orderedIds.length;i++){
      await rpc('assign_question_to_round',{p_round_id:round.id,p_question_id:orderedIds[i],p_canonical_order:i+1});
    }
    await load(eventId);
  };

  const lock=async(round:R)=>{
    try{
      setStatus('Locking…');
      await rpc('lock_round_question_set',{p_round_id:round.id});
      setStatus(`Round ${round.round_number} locked`);
      await load(eventId);
    }catch(e){setStatus(errText(e))}
  };

  const unlock=async(round:R)=>{
    try{
      setStatus('Unlocking…');
      await rpc('unlock_round_question_set',{p_round_id:round.id});
      setStatus(`Round ${round.round_number} unlocked`);
      await load(eventId);
    }catch(e){setStatus(errText(e))}
  };

  const onDragStart=(e:React.DragEvent,payload:DragPayload)=>{
    e.dataTransfer.setData('application/json',JSON.stringify(payload));
    e.dataTransfer.effectAllowed='move';
    setDraggingId(payload.questionId);
  };

  const onDragEnd=()=>{setDraggingId(null);setDragOver(null)};

  const handleDropOnSlot=async(round:R,order:number,e:React.DragEvent)=>{
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    try{
      if(round.questions_locked)throw Error('Unlock this round first');
      const raw=e.dataTransfer.getData('application/json');
      if(!raw)return;
      const payload=JSON.parse(raw) as DragPayload;
      const map=byRound.get(round.id)||new Map<number,string>();
      const current:[number,string][]=[[1,map.get(1)||''],[2,map.get(2)||''],[3,map.get(3)||'']];
      let ids=current.map(([,id])=>id).filter(Boolean);

      // Remove from source round if needed
      if(payload.from!=='pool'&&payload.from!==round.id){
        const src=rounds.find(r=>r.id===payload.from);
        if(src){
          if(src.questions_locked)throw Error(`Round ${src.round_number} is locked`);
          const srcMap=byRound.get(src.id)||new Map();
          const srcIds=[1,2,3].map(n=>srcMap.get(n)).filter(Boolean) as string[];
          await setRoundQuestions(src,srcIds.filter(id=>id!==payload.questionId));
        }
      } else if(payload.from===round.id){
        ids=ids.filter(id=>id!==payload.questionId);
      }

      // Place into target order (swap if occupied)
      const existingAt=map.get(order);
      const without=ids.filter(id=>id!==payload.questionId);
      // Build new 3-slot array
      const slots: (string|null)[]=[map.get(1)||null,map.get(2)||null,map.get(3)||null];
      if(payload.from===round.id){
        // clear old position
        for(let i=0;i<3;i++)if(slots[i]===payload.questionId)slots[i]=null;
      }
      const displaced=slots[order-1];
      slots[order-1]=payload.questionId;
      if(displaced&&displaced!==payload.questionId&&payload.from===round.id&&payload.fromOrder){
        // swap into old slot
        slots[payload.fromOrder-1]=displaced;
      } else if(displaced&&displaced!==payload.questionId&&payload.from!==round.id){
        // push displaced to first empty or fail if full
        const emptyIdx=slots.findIndex((x,i)=>i!==order-1&&!x);
        if(emptyIdx>=0)slots[emptyIdx]=displaced;
        else throw Error('Round is full — remove a question first');
      }
      if(payload.from==='pool'&&!slots.includes(payload.questionId)){
        // already set above
      }
      const finalIds=slots.filter(Boolean) as string[];
      // if coming from pool and round had empty slot, finalIds is fine
      setStatus('Updating…');
      await setRoundQuestions(round,finalIds);
      setStatus(`Updated Round ${round.round_number}`);
    }catch(err){setStatus(errText(err))}
  };

  const removeFromRound=async(round:R,questionId:string)=>{
    try{
      if(round.questions_locked)throw Error('Unlock first');
      const map=byRound.get(round.id)||new Map();
      const ids=[1,2,3].map(n=>map.get(n)).filter(id=>id&&id!==questionId) as string[];
      setStatus('Removing…');
      await setRoundQuestions(round,ids);
      setStatus('Moved to unassigned pool');
    }catch(e){setStatus(errText(e))}
  };

  const addFinal=async(id:string)=>{
    try{if(finalQ.length>=10)throw Error('Final full');await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});await load(eventId);setStatus('Added to Final')}catch(e){setStatus(errText(e))}
  };
  const removeFinal=async(id:string)=>{
    try{await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});await load(eventId);setStatus('Removed from Final')}catch(e){setStatus(errText(e))}
  };
  const validateFinal=async()=>{
    try{await rpc('validate_final_question_set',{p_event_id:eventId});setStatus('Final valid 10/10')}catch(e){setStatus(errText(e))}
  };

  const renderTile=(questionId:string,opts?:{from:string;fromOrder?:number;locked?:boolean})=>{
    const qq=q.find(x=>x.id===questionId);
    if(!qq)return <div className="drop-hint">Missing question</div>;
    const locked=!!opts?.locked;
    return (
      <div
        className={'q-tile'+(draggingId===questionId?' dragging':'')}
        draggable={!locked}
        onDragStart={e=>!locked&&onDragStart(e,{questionId,from:opts?.from||'pool',fromOrder:opts?.fromOrder})}
        onDragEnd={onDragEnd}
      >
        <strong>{qq.stem}</strong>
        <div className="tile-meta">
          <span className="badge">D{qq.difficulty}</span>
          <span className="badge">{categoryName(qq.category_id)}</span>
        </div>
        {!locked&&opts?.from&&opts.from!=='pool'&&(
          <div className="tile-actions">
            <button type="button" className="btn sm danger" onClick={()=>{
              const r=rounds.find(x=>x.id===opts.from);
              if(r)void removeFromRound(r,questionId);
            }}>Remove to pool</button>
          </div>
        )}
      </div>
    );
  };

  const formFields=(
    <>
      <label>Stem</label><textarea value={form.stem} onChange={e=>setForm({...form,stem:e.target.value})}/>
      <div className="row2">
        <div><label>Category</label><input value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></div>
        <div><label>Difficulty</label><input type="number" min={1} max={5} value={form.difficulty} onChange={e=>setForm({...form,difficulty:+e.target.value})}/></div>
      </div>
      <label>Options</label>
      <div className="opts">{form.options.map((o,i)=>(
        <div className="option" key={i}>
          <input type="radio" checked={form.correct===i} onChange={()=>setForm({...form,correct:i})}/>
          <input value={o} onChange={e=>{const z=[...form.options];z[i]=e.target.value;setForm({...form,options:z})}}/>
        </div>
      ))}</div>
      <label>Explanation</label><textarea value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})}/>
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div><small>GERiCARE • ADMIN</small><h1>Question Editor</h1></div>
        <div className="status-pill" title={status}>{status}</div>
      </header>

      <nav className="tabs">
        <button className={'tab'+(tab==='organize'?' on':'')} onClick={()=>setTab('organize')}>Organize by round</button>
        <button className={'tab'+(tab==='bank'?' on':'')} onClick={()=>setTab('bank')}>All questions</button>
        <button className={'tab'+(tab==='final'?' on':'')} onClick={()=>setTab('final')}>Grand Final</button>
      </nav>

      <div className="panel"><div className="sheet">
        {tab==='organize'&&(
          <>
            <p className="hint">Drag questions into slots <b>1 · 2 · 3</b> under each round. Drop on another slot to <b>swap</b>. Unlock a round to edit; Lock when the set is final.</p>

            {rounds.map(r=>{
              const map=byRound.get(r.id)||new Map<number,string>();
              const count=[1,2,3].filter(n=>map.get(n)).length;
              return (
                <div className={'round-block'+(r.questions_locked?' locked':'')} key={r.id}>
                  <div className="round-head">
                    <div>
                      <h3>Round {r.round_number} — {r.title}</h3>
                    </div>
                    <div className="meta">
                      <span className="badge">{count}/3</span>
                      {r.questions_locked?<span className="badge locked">Locked</span>:<span className="badge">{r.status}</span>}
                      {!r.questions_locked&&(
                        <button type="button" className="btn sm primary" disabled={count!==3} onClick={()=>lock(r)}>Lock</button>
                      )}
                      {r.questions_locked&&(
                        <button type="button" className="btn sm danger" disabled={r.status!=='draft'} onClick={()=>unlock(r)}>Unlock</button>
                      )}
                    </div>
                  </div>
                  {[1,2,3].map(order=>{
                    const qid=map.get(order);
                    const key=`${r.id}:${order}`;
                    return (
                      <div
                        key={key}
                        className={'slot-row'+(dragOver===key?' drag-over':'')}
                        onDragOver={e=>{e.preventDefault();if(!r.questions_locked)setDragOver(key)}}
                        onDragLeave={()=>setDragOver(d=>d===key?null:d)}
                        onDrop={e=>handleDropOnSlot(r,order,e)}
                      >
                        <div className={'order-badge'+(qid?'':' empty')}>{order}</div>
                        {qid
                          ? renderTile(qid,{from:r.id,fromOrder:order,locked:r.questions_locked})
                          : <div className="drop-hint">{r.questions_locked?'Empty':'Drop question here'}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div className="pool-block">
              <h3>Unassigned approved ({pool.length})</h3>
              <p className="hint">Drag from here into any unlocked round slot.</p>
              <div className="pool-list">
                {!pool.length&&<div className="empty">No free approved questions.</div>}
                {pool.map(x=>(
                  <div key={x.id}>{renderTile(x.id,{from:'pool'})}</div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab==='bank'&&(
          <>
            <input className="search" placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
            <div className="filters">
              <button className={'chip'+(filter==='all'?' on':'')} onClick={()=>setFilter('all')}>All</button>
              <button className={'chip'+(filter==='draft'?' on':'')} onClick={()=>setFilter('draft')}>Draft</button>
              <button className={'chip'+(filter==='approved'?' on':'')} onClick={()=>setFilter('approved')}>Approved</button>
            </div>
            {filteredBank.map(x=>{
              const open=sel?.id===x.id;
              const usage=allRQ.find(r=>r.question_id===x.id);
              const rr=usage?rounds.find(r=>r.id===usage.round_id):null;
              return (
                <div key={x.id} style={{border:'1px solid #e5e8ef',borderRadius:14,marginBottom:8,overflow:'hidden'}}>
                  <button type="button" style={{width:'100%',textAlign:'left',border:0,background:open?'#f8fafc':'#fff',padding:12,cursor:'pointer',font:'inherit'}} onClick={()=>loadQuestion(x)}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                      <span className={'badge '+x.status}>{x.status}</span>
                      {rr&&<span className="badge">R{rr.round_number} · #{usage!.canonical_order}</span>}
                    </div>
                    <strong style={{fontSize:14}}>{x.stem}</strong>
                  </button>
                  {open&&(
                    <div style={{padding:12,borderTop:'1px solid #edf0f4',background:'#f8fafc'}}>
                      {selOpts.map(o=><div key={o.option_key} className={'optline'+(o.is_correct?' ok':'')}><b>{o.option_key}</b> {o.option_text}</div>)}
                      <div className="actions">
                        <button className="btn primary" onClick={()=>openEdit(x,selOpts)}>Edit</button>
                        <button className="btn primary" disabled={x.status==='approved'||busy} onClick={approve}>{x.status==='approved'?'Approved':'QA & Approve'}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {tab==='final'&&(
          <>
            <div className="actions" style={{marginBottom:12}}>
              <strong>{finalQ.length}/10</strong>
              <button className="btn primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate</button>
            </div>
            {finalQ.map(f=>{
              const qq=q.find(x=>x.id===f.question_id);
              return (
                <div key={f.question_id} className="slot-row">
                  <div className="order-badge">{f.canonical_order}</div>
                  <div className="q-tile" style={{cursor:'default'}}>
                    <strong>{qq?.stem??f.question_id}</strong>
                    <div className="tile-actions"><button className="btn sm danger" onClick={()=>removeFinal(f.question_id)}>Remove</button></div>
                  </div>
                </div>
              );
            })}
            <h3 style={{marginTop:16,fontSize:14}}>Add from unassigned</h3>
            {pool.map(x=>(
              <div key={x.id} className="q-tile" style={{marginBottom:8,cursor:'default'}}>
                <strong>{x.stem}</strong>
                <div className="tile-actions"><button className="btn sm primary" onClick={()=>addFinal(x.id)}>Add to Final</button></div>
              </div>
            ))}
          </>
        )}
      </div></div>

      {(tab==='bank'||tab==='organize')&&<button className="fab" onClick={openCreate}>+</button>}

      {modal&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}>
          <div className="modal">
            <div className="close-row"><h2>{modal==='create'?'New':'Edit'}</h2><button className="btn" onClick={()=>setModal(null)}>Close</button></div>
            {modal==='create'&&<><label>AI topic</label><div className="row2"><input value={aiTopic} onChange={e=>setAiTopic(e.target.value)}/><button className="btn" disabled={busy||!aiTopic.trim()} onClick={generate}>Generate</button></div></>}
            {formFields}
            <div className="modal-actions">
              <button className="btn primary" disabled={busy} onClick={modal==='create'?saveCreate:saveEdit}>{busy?'…':'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
