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
type Tab='setup'|'bank';
type Scope='round'|'final';
type Form={stem:string;category:string;difficulty:number;points:number;options:string[];correct:number;explanation:string};

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
  const[tab,setTab]=useState<Tab>('setup');
  const[scope,setScope]=useState<Scope>('round');
  const[eventId,setEventId]=useState(configuredEvent??'');
  const[q,setQ]=useState<Q[]>([]);
  const[rounds,setRounds]=useState<R[]>([]);
  const[cats,setCats]=useState<C[]>([]);
  const[allRQ,setAllRQ]=useState<RQ[]>([]);
  const[roundId,setRoundId]=useState<string|null>(null);
  const[finalQ,setFinalQ]=useState<FQ[]>([]);
  const[status,setStatus]=useState('Ready');
  const[sel,setSel]=useState<Q|null>(null);
  const[selOpts,setSelOpts]=useState<O[]>([]);
  const[search,setSearch]=useState('');
  const[reserveSearch,setReserveSearch]=useState('');
  const[filter,setFilter]=useState<'all'|'draft'|'approved'>('all');
  const[modal,setModal]=useState<'create'|'edit'|null>(null);
  const[form,setForm]=useState<Form>(emptyForm());
  const[aiTopic,setAiTopic]=useState('');
  const[busy,setBusy]=useState(false);
  const[lastRemoved,setLastRemoved]=useState<{kind:'round'|'final';roundId?:string;questionId:string;stem:string}|null>(null);

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
    if(!sb){setStatus('Configure Supabase');return}
    try{
      const eid=id||eventId||await resolveEvent();
      if(!eid)return;
      const rr=await sb.from('rounds').select('id,event_id,round_number,title,status,questions_locked').eq('event_id',eid).order('round_number');
      if(rr.error)throw rr.error;
      const rlist=rr.data??[];
      const ids=rlist.map(r=>r.id);
      const[a,c,d,rq]=await Promise.all([
        sb.from('questions').select('id,event_id,category_id,stem,status,difficulty,points,explanation,reference_text,created_at').eq('event_id',eid).order('created_at',{ascending:false}),
        sb.from('categories').select('id,name,slug').eq('event_id',eid).order('name'),
        sb.from('final_questions').select('question_id,canonical_order').eq('event_id',eid).order('canonical_order'),
        ids.length?sb.from('round_questions').select('round_id,question_id,canonical_order').in('round_id',ids):Promise.resolve({data:[],error:null}),
      ]);
      if(a.error||c.error||d.error||rq.error)throw(a.error||c.error||d.error||rq.error);
      setQ(a.data??[]);setRounds(rlist);setCats(c.data??[]);setFinalQ(d.data??[]);setAllRQ((rq.data??[]) as RQ[]);
      setRoundId(prev=>prev&&rlist.some(r=>r.id===prev)?prev:(rlist[0]?.id??null));
    }catch(e){setStatus(errText(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(errText(e)))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';
  const active=rounds.find(r=>r.id===roundId)??null;

  const slots=useMemo(()=>{
    if(!active)return [null,null,null] as (string|null)[];
    const m=new Map(allRQ.filter(r=>r.round_id===active.id).map(r=>[r.canonical_order,r.question_id]));
    return [m.get(1)??null,m.get(2)??null,m.get(3)??null];
  },[active,allRQ]);

  const assignedIds=useMemo(()=>new Set(allRQ.map(r=>r.question_id)),[allRQ]);
  const finalIds=useMemo(()=>new Set(finalQ.map(f=>f.question_id)),[finalQ]);

  const reserve=useMemo(()=>{
    const s=reserveSearch.toLowerCase();
    return q.filter(x=>{
      if(x.status!=='approved')return false;
      if(assignedIds.has(x.id)||finalIds.has(x.id))return false;
      if(s&&!x.stem.toLowerCase().includes(s)&&!categoryName(x.category_id).toLowerCase().includes(s))return false;
      return true;
    });
  },[q,assignedIds,finalIds,reserveSearch,cats]);

  const countFor=(rid:string)=>allRQ.filter(r=>r.round_id===rid).length;

  const setRoundOrder=async(round:R,ordered:string[])=>{
    if(round.questions_locked)throw Error('Unlock this round first');
    if(ordered.length>3)throw Error('Max 3 questions');
    const current=allRQ.filter(r=>r.round_id===round.id);
    for(const row of current)await rpc('remove_question_from_round',{p_round_id:round.id,p_question_id:row.question_id});
    for(let i=0;i<ordered.length;i++)await rpc('assign_question_to_round',{p_round_id:round.id,p_question_id:ordered[i],p_canonical_order:i+1});
    await load(eventId);
  };

  const addToRound=async(questionId:string)=>{
    if(!active)return;
    try{
      const ordered=slots.filter(Boolean) as string[];
      if(ordered.length>=3)throw Error('This round already has 3 questions');
      if(ordered.includes(questionId))return;
      setStatus('Adding…');
      await setRoundOrder(active,[...ordered,questionId]);
      if(lastRemoved?.questionId===questionId)setLastRemoved(null);
      setStatus(`Added to Round ${active.round_number}`);
    }catch(e){setStatus(errText(e))}
  };

  const removeFromRound=async(questionId:string)=>{
    if(!active)return;
    const qq=q.find(x=>x.id===questionId);
    if(!window.confirm(`Move back to Reserve?\n\n${qq?.stem??''}`))return;
    try{
      setStatus('Removing…');
      const ordered=(slots.filter(Boolean) as string[]).filter(id=>id!==questionId);
      await setRoundOrder(active,ordered);
      setLastRemoved({kind:'round',roundId:active.id,questionId,stem:qq?.stem??questionId});
      setStatus('Moved to Reserve');
    }catch(e){setStatus(errText(e))}
  };

  const move=async(index:number,dir:-1|1)=>{
    if(!active)return;
    const ordered=[...slots];
    const j=index+dir;
    if(j<0||j>2||!ordered[index])return;
    const tmp=ordered[index];ordered[index]=ordered[j];ordered[j]=tmp;
    try{
      setStatus('Reordering…');
      await setRoundOrder(active,ordered.filter(Boolean) as string[]);
      setStatus('Order updated');
    }catch(e){setStatus(errText(e))}
  };

  const undo=async()=>{
    if(!lastRemoved)return;
    if(lastRemoved.kind==='round'&&active&&lastRemoved.roundId===active.id)await addToRound(lastRemoved.questionId);
    if(lastRemoved.kind==='final')await addFinal(lastRemoved.questionId);
  };

  const lock=async()=>{
    if(!active)return;
    try{setStatus('Locking…');await rpc('lock_round_question_set',{p_round_id:active.id});setStatus('Locked');await load(eventId)}catch(e){setStatus(errText(e))}
  };
  const unlock=async()=>{
    if(!active)return;
    try{setStatus('Unlocking…');await rpc('unlock_round_question_set',{p_round_id:active.id});setStatus('Unlocked');await load(eventId)}catch(e){setStatus(errText(e))}
  };

  const addFinal=async(id:string)=>{
    try{
      if(finalQ.length>=10)throw Error('Final already has 10');
      setStatus('Adding to Final…');
      await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});
      if(lastRemoved?.questionId===id)setLastRemoved(null);
      await load(eventId);
      setStatus('Added to Grand Final');
    }catch(e){setStatus(errText(e))}
  };

  const removeFinal=async(id:string)=>{
    const qq=q.find(x=>x.id===id);
    if(!window.confirm(`Move back to Reserve?\n\n${qq?.stem??''}`))return;
    try{
      setStatus('Removing…');
      await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});
      setLastRemoved({kind:'final',questionId:id,stem:qq?.stem??id});
      await load(eventId);
      setStatus('Moved to Reserve');
    }catch(e){setStatus(errText(e))}
  };

  const moveFinal=async(index:number,dir:-1|1)=>{
    const j=index+dir;
    if(j<0||j>=finalQ.length)return;
    try{
      // Rebuild order: remove all then re-add — same pattern as rounds
      setStatus('Reordering Final…');
      const ids=finalQ.map(f=>f.question_id);
      const tmp=ids[index];ids[index]=ids[j];ids[j]=tmp;
      for(const id of [...ids])await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});
      // After removes, re-add in new order — but we already removed all; need careful: remove each once
      // Actually after first remove list changes. Better: remove all first from snapshot
      await load(eventId);
      // Reload then clear all remaining and set
      const{data:cur}=await sb!.from('final_questions').select('question_id').eq('event_id',eventId);
      for(const row of cur??[])await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:row.question_id});
      for(let i=0;i<ids.length;i++)await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:ids[i],p_canonical_order:i+1});
      await load(eventId);
      setStatus('Final order updated');
    }catch(e){setStatus(errText(e))}
  };

  const validateFinal=async()=>{
    try{await rpc('validate_final_question_set',{p_event_id:eventId});setStatus('Final OK · 10/10')}catch(e){setStatus(errText(e))}
  };

  const loadQuestion=async(x:Q)=>{
    if(sel?.id===x.id){setSel(null);setSelOpts([]);return}
    setSel(x);
    if(!sb)return;
    const{data,error}=await sb.from('question_options').select('option_key,option_text,is_correct').eq('question_id',x.id).order('option_key');
    if(error)setStatus(errText(error));else setSelOpts(data??[]);
  };

  const openEdit=(x:Q,opts:O[])=>{
    const ordered=['A','B','C','D'].map(k=>opts.find(o=>o.option_key===k)?.option_text??'');
    const correct=Math.max(0,opts.findIndex(o=>o.is_correct));
    setForm({stem:x.stem,category:categoryName(x.category_id)==='Uncategorised'?'':categoryName(x.category_id),difficulty:x.difficulty,points:x.points,options:ordered,correct:correct>=0?correct:0,explanation:x.explanation??''});
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
      if(!form.stem.trim()||form.options.some(o=>!o.trim()))throw Error('Stem and 4 options required');
      setBusy(true);
      const category_id=await ensureCategory(form.category);
      const{data:user}=await sb!.auth.getUser();
      const{data:x,error}=await sb!.from('questions').insert({event_id:eventId,category_id,stem:form.stem.trim(),status:'draft',difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null,created_by:user.user?.id??null}).select('id').single();
      if(error)throw error;
      const{error:oe}=await sb!.from('question_options').insert(form.options.map((t,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text:t.trim(),is_correct:i===form.correct})));
      if(oe)throw oe;
      setModal(null);setStatus('Draft saved');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const saveEdit=async()=>{
    if(!sel)return;
    try{
      setBusy(true);
      const category_id=await ensureCategory(form.category);
      const{error}=await sb!.from('questions').update({stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null}).eq('id',sel.id);
      if(error)throw error;
      await sb!.from('question_options').delete().eq('question_id',sel.id);
      await sb!.from('question_options').insert(form.options.map((t,i)=>({question_id:sel.id,option_key:String.fromCharCode(65+i),option_text:t.trim(),is_correct:i===form.correct})));
      setModal(null);setStatus('Saved');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const approve=async()=>{
    if(!sel||!sb)return;
    try{
      setBusy(true);
      const correct=selOpts.findIndex(o=>o.is_correct);
      const{data:qa,error:qe}=await sb.functions.invoke('question-ai',{body:{action:'qa',event_id:eventId,stem:sel.stem,options:selOpts.map(o=>o.option_text),correct_index:correct,explanation:sel.explanation??'',difficulty:sel.difficulty,category:categoryName(sel.category_id)}});
      if(qe)throw qe;
      if(!qa?.pass)throw Error('QA failed');
      const{data:user}=await sb.auth.getUser();
      await sb.from('questions').update({status:'approved',approved_by:user.user?.id??null,approved_at:new Date().toISOString()}).eq('id',sel.id);
      setStatus('Approved');await load(eventId);setSel({...sel,status:'approved'});
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const generate=async()=>{
    try{
      setBusy(true);
      const{data,error}=await sb!.functions.invoke('question-ai',{body:{action:'generate',event_id:eventId,topic:aiTopic,difficulty:form.difficulty}});
      if(error)throw error;
      if(data?.error)throw Error(data.message||data.error);
      const d=data.draft;
      setForm({stem:d.stem,category:d.category??'',difficulty:d.difficulty??3,points:10,options:d.options||form.options,correct:d.correct_index??0,explanation:d.explanation??''});
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const bankList=useMemo(()=>q.filter(x=>{
    if(filter!=='all'&&x.status!==filter)return false;
    return x.stem.toLowerCase().includes(search.toLowerCase());
  }),[q,filter,search]);

  return (
    <div className="app">
      <header className="topbar">
        <div><small>GERiCARE</small><h1>Question setup</h1></div>
        <div className="pill">{status}</div>
      </header>

      <nav className="tabs">
        <button type="button" className={'tab'+(tab==='setup'?' on':'')} onClick={()=>setTab('setup')}>Rounds</button>
        <button type="button" className={'tab'+(tab==='bank'?' on':'')} onClick={()=>setTab('bank')}>Bank</button>
      </nav>

      <div className="wrap"><div className="card">
        {tab==='setup'&&(
          <>
            <div className="chips">
              {rounds.map(r=>(
                <button key={r.id} type="button" className={'chip'+(scope==='round'&&roundId===r.id?' sel':'')} onClick={()=>{setScope('round');setRoundId(r.id);setLastRemoved(null)}}>
                  R{r.round_number}
                  <span className="sub">{countFor(r.id)}/3{r.questions_locked?' · lock':''}</span>
                </button>
              ))}
              <button type="button" className={'chip'+(scope==='final'?' sel':'')} onClick={()=>{setScope('final');setLastRemoved(null)}}>
                Final
                <span className="sub">{finalQ.length}/10</span>
              </button>
            </div>

            {scope==='round'&&!active&&<div className="empty">No rounds</div>}

            {scope==='round'&&active&&(
              <>
                <div className="row-head">
                  <div>
                    <h2>Round {active.round_number} — {active.title}</h2>
                    <p>{active.questions_locked?'Locked':'Unlocked'} · {slots.filter(Boolean).length}/3 · {active.status}</p>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    {!active.questions_locked&&<button type="button" className="btn primary" disabled={slots.filter(Boolean).length!==3} onClick={lock}>Lock set</button>}
                    {active.questions_locked&&<button type="button" className="btn danger" disabled={active.status!=='draft'} onClick={unlock}>Unlock</button>}
                  </div>
                </div>

                {lastRemoved&&lastRemoved.kind==='round'&&lastRemoved.roundId===active.id&&(
                  <div className="undo">
                    <p><b>Removed:</b> {lastRemoved.stem}</p>
                    <button type="button" className="btn primary" disabled={active.questions_locked||slots.filter(Boolean).length>=3} onClick={undo}>Undo</button>
                  </div>
                )}

                {[0,1,2].map(i=>{
                  const id=slots[i];
                  const qq=id?q.find(x=>x.id===id):null;
                  return (
                    <div key={i} className={'slot'+(qq?' filled':' empty')}>
                      <div className={'num'+(qq?'':' muted')}>{i+1}</div>
                      <div>
                        {qq?<><strong>{qq.stem}</strong><div className="meta">{categoryName(qq.category_id)} · D{qq.difficulty}</div></>
                          :<span style={{color:'#9ca3af',fontSize:13}}>Empty — add from Reserve</span>}
                      </div>
                      {qq&&!active.questions_locked&&(
                        <div className="slot-actions">
                          <button type="button" className="btn icon" disabled={i===0} onClick={()=>move(i,-1)}>↑</button>
                          <button type="button" className="btn icon" disabled={i===2||!slots[i+1]} onClick={()=>move(i,1)}>↓</button>
                          <button type="button" className="btn icon danger" onClick={()=>removeFromRound(qq.id)}>✕</button>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="sec">
                  <h3>Reserve</h3>
                  <p className="hint">Add to Round {active.round_number} (next empty slot).</p>
                  <input className="search" placeholder="Search reserve…" value={reserveSearch} onChange={e=>setReserveSearch(e.target.value)}/>
                  {!reserve.length&&<div className="empty">No free approved questions.</div>}
                  {reserve.map(x=>(
                    <div className="reserve" key={x.id}>
                      <span className="badge ok">Free</span>
                      <strong>{x.stem}</strong>
                      <div className="meta">{categoryName(x.category_id)} · D{x.difficulty}</div>
                      <div className="actions">
                        <button type="button" className="btn primary" disabled={active.questions_locked||slots.filter(Boolean).length>=3} onClick={()=>addToRound(x.id)}>Add to R{active.round_number}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {scope==='final'&&(
              <>
                <div className="row-head">
                  <div>
                    <h2>Grand Final</h2>
                    <p>{finalQ.length}/10 questions</p>
                  </div>
                  <button type="button" className="btn primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate 10</button>
                </div>

                {lastRemoved&&lastRemoved.kind==='final'&&(
                  <div className="undo">
                    <p><b>Removed:</b> {lastRemoved.stem}</p>
                    <button type="button" className="btn primary" disabled={finalQ.length>=10} onClick={undo}>Undo</button>
                  </div>
                )}

                {finalQ.map((f,i)=>{
                  const qq=q.find(x=>x.id===f.question_id);
                  return (
                    <div className="slot filled" key={f.question_id}>
                      <div className="num">{f.canonical_order}</div>
                      <div><strong>{qq?.stem??f.question_id}</strong></div>
                      <div className="slot-actions">
                        <button type="button" className="btn icon" disabled={i===0} onClick={()=>moveFinal(i,-1)}>↑</button>
                        <button type="button" className="btn icon" disabled={i===finalQ.length-1} onClick={()=>moveFinal(i,1)}>↓</button>
                        <button type="button" className="btn icon danger" onClick={()=>removeFinal(f.question_id)}>✕</button>
                      </div>
                    </div>
                  );
                })}
                {!finalQ.length&&<div className="empty">No final questions yet — add from Reserve.</div>}

                <div className="sec">
                  <h3>Reserve</h3>
                  <p className="hint">Add to Grand Final (up to 10).</p>
                  <input className="search" placeholder="Search reserve…" value={reserveSearch} onChange={e=>setReserveSearch(e.target.value)}/>
                  {reserve.map(x=>(
                    <div className="reserve" key={x.id}>
                      <span className="badge ok">Free</span>
                      <strong>{x.stem}</strong>
                      <div className="actions">
                        <button type="button" className="btn primary" disabled={finalQ.length>=10} onClick={()=>addFinal(x.id)}>Add to Final</button>
                      </div>
                    </div>
                  ))}
                  {!reserve.length&&<div className="empty">No free approved questions.</div>}
                </div>
              </>
            )}
          </>
        )}

        {tab==='bank'&&(
          <>
            <input className="search" placeholder="Search bank…" value={search} onChange={e=>setSearch(e.target.value)}/>
            <div style={{display:'flex',gap:6,marginBottom:10}}>
              {(['all','draft','approved'] as const).map(f=>(
                <button key={f} type="button" className={'btn'+(filter===f?' primary':'')} onClick={()=>setFilter(f)}>{f}</button>
              ))}
            </div>
            {bankList.map(x=>{
              const open=sel?.id===x.id;
              const usage=allRQ.find(r=>r.question_id===x.id);
              const rr=usage?rounds.find(r=>r.id===usage.round_id):null;
              const inFinal=finalIds.has(x.id);
              return (
                <div className="qrow" key={x.id}>
                  <button type="button" className="qrow-h" onClick={()=>loadQuestion(x)}>
                    <span className={'badge '+(x.status==='approved'?'ok':'warn')}>{x.status}</span>
                    {rr&&<span className="badge">R{rr.round_number} #{usage!.canonical_order}</span>}
                    {inFinal&&<span className="badge">Final</span>}
                    <strong style={{display:'block',marginTop:6,fontSize:13}}>{x.stem}</strong>
                  </button>
                  {open&&(
                    <div className="qrow-b">
                      {selOpts.map(o=><div key={o.option_key} className={'optline'+(o.is_correct?' ok':'')}>{o.option_key}. {o.option_text}</div>)}
                      <div style={{display:'flex',gap:6,marginTop:8}}>
                        <button type="button" className="btn primary" onClick={()=>openEdit(x,selOpts)}>Edit</button>
                        <button type="button" className="btn primary" disabled={x.status==='approved'||busy} onClick={approve}>Approve</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div></div>

      <button type="button" className="fab" onClick={openCreate}>+</button>

      {modal&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}>
          <div className="modal">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h2>{modal==='create'?'New question':'Edit'}</h2>
              <button type="button" className="btn" onClick={()=>setModal(null)}>Close</button>
            </div>
            {modal==='create'&&(
              <><label>AI topic</label><div style={{display:'flex',gap:8}}><input value={aiTopic} onChange={e=>setAiTopic(e.target.value)}/><button type="button" className="btn" disabled={!aiTopic.trim()||busy} onClick={generate}>AI</button></div></>
            )}
            <label>Stem</label><textarea value={form.stem} onChange={e=>setForm({...form,stem:e.target.value})}/>
            <label>Category</label><input value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/>
            <label>Options</label>
            <div className="opts">{form.options.map((o,i)=>(
              <div className="option" key={i}>
                <input type="radio" checked={form.correct===i} onChange={()=>setForm({...form,correct:i})}/>
                <input value={o} onChange={e=>{const z=[...form.options];z[i]=e.target.value;setForm({...form,options:z})}}/>
              </div>
            ))}</div>
            <label>Explanation</label><textarea value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})}/>
            <div style={{marginTop:12}}><button type="button" className="btn primary" disabled={busy} onClick={modal==='create'?saveCreate:saveEdit}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
