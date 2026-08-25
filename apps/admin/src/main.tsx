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
type Tab='bank'|'rounds'|'final';
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
  const[tab,setTab]=useState<Tab>('bank');
  const[eventId,setEventId]=useState(configuredEvent??'');
  const[q,setQ]=useState<Q[]>([]);
  const[rounds,setRounds]=useState<R[]>([]);
  const[cats,setCats]=useState<C[]>([]);
  const[allRQ,setAllRQ]=useState<RQ[]>([]);
  const[sel,setSel]=useState<Q|null>(null);
  const[selOpts,setSelOpts]=useState<O[]>([]);
  const[search,setSearch]=useState('');
  const[filter,setFilter]=useState<'all'|'draft'|'approved'>('all');
  const[selectedRound,setSelectedRound]=useState<R|null>(null);
  const[assigned,setAssigned]=useState<{question_id:string;canonical_order:number}[]>([]);
  const[finalQ,setFinalQ]=useState<FQ[]>([]);
  const[status,setStatus]=useState('Ready');
  const[modal,setModal]=useState<'create'|'edit'|null>(null);
  const[form,setForm]=useState<Form>(emptyForm());
  const[aiTopic,setAiTopic]=useState('');
  const[busy,setBusy]=useState(false);
  const[lastRemoved,setLastRemoved]=useState<{roundId:string;questionId:string;stem:string}|null>(null);
  const[poolSearch,setPoolSearch]=useState('');

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
        roundIds.length
          ? sb.from('round_questions').select('round_id,question_id,canonical_order').in('round_id',roundIds)
          : Promise.resolve({data:[],error:null}),
      ]);
      if(a.error||c.error||d.error||rq.error)throw(a.error||c.error||d.error||rq.error);
      setQ(a.data??[]);
      setRounds(rlist);
      setCats(c.data??[]);
      setFinalQ(d.data??[]);
      setAllRQ((rq.data??[]) as RQ[]);
    }catch(e){setStatus(errText(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(errText(e)))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';
  const roundById=(id:string)=>rounds.find(r=>r.id===id);

  const usageByQuestion=useMemo(()=>{
    const map=new Map<string,{roundId:string;roundNumber:number;order:number}>();
    for(const row of allRQ){
      const rr=roundById(row.round_id);
      map.set(row.question_id,{roundId:row.round_id,roundNumber:rr?.round_number??0,order:row.canonical_order});
    }
    return map;
  },[allRQ,rounds]);

  const filtered=useMemo(()=>{
    return q.filter(x=>{
      if(filter!=='all'&&x.status!==filter)return false;
      const hay=(x.stem+' '+categoryName(x.category_id)).toLowerCase();
      return hay.includes(search.toLowerCase());
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
      if(!form.stem.trim()||form.options.some(x=>!x.trim()))throw Error('Stem and all four options are required');
      setBusy(true);setStatus('Saving draft…');
      const category_id=await ensureCategory(form.category);
      const{data:user}=await sb.auth.getUser();
      const{data:x,error}=await sb.from('questions').insert({event_id:eventId,category_id,stem:form.stem.trim(),status:'draft',difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null,created_by:user.user?.id??null,ai_metadata:aiTopic?{generated:true,topic:aiTopic}:{}}).select('id').single();
      if(error)throw error;
      const{error:oe}=await sb.from('question_options').insert(form.options.map((option_text,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text:option_text.trim(),is_correct:i===form.correct})));
      if(oe)throw oe;
      setModal(null);setStatus('Draft saved');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const saveEdit=async()=>{
    if(!sel||!sb)return;
    try{
      if(!form.stem.trim()||form.options.some(x=>!x.trim()))throw Error('Stem and all four options are required');
      setBusy(true);setStatus('Saving changes…');
      const category_id=await ensureCategory(form.category);
      const{error}=await sb.from('questions').update({stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null}).eq('id',sel.id);
      if(error)throw error;
      const{error:de}=await sb.from('question_options').delete().eq('question_id',sel.id);
      if(de)throw de;
      const{error:oe}=await sb.from('question_options').insert(form.options.map((option_text,i)=>({question_id:sel.id,option_key:String.fromCharCode(65+i),option_text:option_text.trim(),is_correct:i===form.correct})));
      if(oe)throw oe;
      setModal(null);setStatus('Question updated');await load(eventId);
      await loadQuestion({...sel,stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null});
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const generate=async()=>{
    try{
      if(!sb||!eventId)throw Error('Event not configured');
      if(!aiTopic.trim())throw Error('Enter a topic');
      setBusy(true);setStatus('Generating with AI…');
      const{data,error}=await sb.functions.invoke('question-ai',{body:{action:'generate',event_id:eventId,topic:aiTopic,difficulty:form.difficulty,category:form.category||undefined}});
      if(error)throw error;
      if(data?.error)throw Error(data.message||data.detail||data.error);
      const d=data.draft;
      setForm({stem:d.stem,category:d.category??form.category,difficulty:d.difficulty??form.difficulty,points:10,options:Array.isArray(d.options)?d.options:form.options,correct:typeof d.correct_index==='number'?d.correct_index:0,explanation:d.explanation??''});
      setStatus('AI draft ready — review before saving');
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const approve=async()=>{
    if(!sel||!sb)return;
    try{
      setBusy(true);setStatus('Running QA…');
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

  const loadAssigned=async(r:R)=>{
    setSelectedRound(r);
    setLastRemoved(null);
    if(!sb)return;
    const{data,error}=await sb.from('round_questions').select('question_id,canonical_order').eq('round_id',r.id).order('canonical_order');
    if(error)setStatus(errText(error));else setAssigned(data??[]);
  };

  const assign=async(questionId:string)=>{
    if(!selectedRound)return;
    try{
      if(selectedRound.questions_locked)throw Error('Unlock the round first');
      if(assigned.length>=3)throw Error('Round already has 3 questions');
      const usage=usageByQuestion.get(questionId);
      if(usage&&usage.roundId!==selectedRound.id)throw Error(`Already in Round ${usage.roundNumber}`);
      setStatus('Assigning…');
      await rpc('assign_question_to_round',{p_round_id:selectedRound.id,p_question_id:questionId,p_canonical_order:assigned.length+1});
      if(lastRemoved?.questionId===questionId)setLastRemoved(null);
      await load(eventId);
      await loadAssigned(selectedRound);
      setStatus('Question added to round');
    }catch(e){setStatus(errText(e))}
  };

  const remove=async(questionId:string)=>{
    if(!selectedRound)return;
    const qq=q.find(x=>x.id===questionId);
    if(!window.confirm(`Remove this question from Round ${selectedRound.round_number}?\n\n${qq?.stem??questionId}\n\nYou can Undo for a short time after.`))return;
    try{
      setStatus('Removing…');
      await rpc('remove_question_from_round',{p_round_id:selectedRound.id,p_question_id:questionId});
      setLastRemoved({roundId:selectedRound.id,questionId,stem:qq?.stem??questionId});
      await load(eventId);
      await loadAssigned(selectedRound);
      setStatus('Removed — use Undo if that was a mistake');
    }catch(e){setStatus(errText(e))}
  };

  const undoRemove=async()=>{
    if(!lastRemoved||!selectedRound||selectedRound.id!==lastRemoved.roundId)return;
    await assign(lastRemoved.questionId);
  };

  const lock=async()=>{
    if(!selectedRound)return;
    try{setStatus('Locking…');await rpc('lock_round_question_set',{p_round_id:selectedRound.id});setSelectedRound({...selectedRound,questions_locked:true});setStatus('Question set locked');await load(eventId)}catch(e){setStatus(errText(e))}
  };

  const unlock=async()=>{
    if(!selectedRound)return;
    try{setStatus('Unlocking…');await rpc('unlock_round_question_set',{p_round_id:selectedRound.id});setSelectedRound({...selectedRound,questions_locked:false});setStatus('Unlocked');await load(eventId)}catch(e){setStatus(errText(e))}
  };

  const addFinal=async(id:string)=>{
    try{if(finalQ.length>=10)throw Error('Final already has 10 questions');setStatus('Adding…');await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});await load(eventId);setStatus('Added to Grand Final')}catch(e){setStatus(errText(e))}
  };

  const removeFinal=async(id:string)=>{
    try{setStatus('Removing…');await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});await load(eventId);setStatus('Removed from Final')}catch(e){setStatus(errText(e))}
  };

  const validateFinal=async()=>{
    try{await rpc('validate_final_question_set',{p_event_id:eventId});setStatus('Grand Final valid: 10/10')}catch(e){setStatus(errText(e))}
  };

  // Pool for current round: approved questions with clear usage labels
  const pool=useMemo(()=>{
    const s=poolSearch.toLowerCase();
    return q.filter(x=>{
      if(x.status!=='approved')return false;
      if(s&&!x.stem.toLowerCase().includes(s))return false;
      return true;
    }).map(x=>{
      const u=usageByQuestion.get(x.id);
      const inFinal=finalQ.some(f=>f.question_id===x.id);
      let label:'available'|'this-round'|'other-round'|'final';
      if(u&&selectedRound&&u.roundId===selectedRound.id)label='this-round';
      else if(u)label='other-round';
      else if(inFinal)label='final';
      else label='available';
      return {q:x,label,roundNumber:u?.roundNumber};
    });
  },[q,poolSearch,usageByQuestion,selectedRound,finalQ]);

  const availablePool=pool.filter(p=>p.label==='available');
  const otherPool=pool.filter(p=>p.label!=='available'&&p.label!=='this-round');

  const formFields=(
    <>
      <label>Question stem</label>
      <textarea value={form.stem} onChange={e=>setForm({...form,stem:e.target.value})}/>
      <div className="row2">
        <div><label>Category</label><input value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></div>
        <div><label>Difficulty</label><input type="number" min={1} max={5} value={form.difficulty} onChange={e=>setForm({...form,difficulty:+e.target.value})}/></div>
      </div>
      <label>Options (select correct)</label>
      <div className="opts">{form.options.map((o,i)=>(
        <div className="option" key={i}>
          <input type="radio" name="correct" checked={form.correct===i} onChange={()=>setForm({...form,correct:i})}/>
          <input value={o} onChange={e=>{const z=[...form.options];z[i]=e.target.value;setForm({...form,options:z})}} placeholder={`Option ${String.fromCharCode(65+i)}`}/>
        </div>
      ))}</div>
      <label>Explanation</label>
      <textarea value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})}/>
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div><small>GERiCARE • ADMIN</small><h1>Question Editor</h1></div>
        <div className="status-pill" title={status}>{status}</div>
      </header>

      <nav className="tabs">
        <button className={'tab'+(tab==='bank'?' on':'')} onClick={()=>setTab('bank')}>Question Bank</button>
        <button className={'tab'+(tab==='rounds'?' on':'')} onClick={()=>setTab('rounds')}>Rounds</button>
        <button className={'tab'+(tab==='final'?' on':'')} onClick={()=>setTab('final')}>Grand Final</button>
      </nav>

      <div className="panel"><div className="sheet">
        {tab==='bank'&&(
          <>
            <input className="search" placeholder="Search questions…" value={search} onChange={e=>setSearch(e.target.value)}/>
            <div className="filters">
              <button className={'chip'+(filter==='all'?' on':'')} onClick={()=>setFilter('all')}>All ({q.length})</button>
              <button className={'chip'+(filter==='draft'?' on':'')} onClick={()=>setFilter('draft')}>Draft</button>
              <button className={'chip'+(filter==='approved'?' on':'')} onClick={()=>setFilter('approved')}>Approved</button>
            </div>
            <div className="qlist">
              {filtered.map(x=>{
                const open=sel?.id===x.id;
                const u=usageByQuestion.get(x.id);
                return (
                  <div key={x.id} className={'qcard'+(open?' sel':'')}>
                    <button type="button" className="qcard-head" onClick={()=>loadQuestion(x)}>
                      <div className="meta">
                        <span className={'badge '+x.status}>{x.status}</span>
                        <span className="badge">D{x.difficulty}</span>
                        {u&&<span className="badge in-round">R{u.roundNumber}</span>}
                      </div>
                      <strong>{x.stem}</strong>
                      <small>{categoryName(x.category_id)} · {x.points} pts</small>
                    </button>
                    {open&&(
                      <div className="qcard-body">
                        {selOpts.map(o=><div key={o.option_key} className={'optline'+(o.is_correct?' ok':'')}><b>{o.option_key}</b><span>{o.option_text}</span></div>)}
                        {sel?.explanation&&<p className="expl">{sel.explanation}</p>}
                        <div className="actions">
                          <button type="button" className="btn primary" onClick={()=>openEdit(x,selOpts)}>Edit</button>
                          <button type="button" className="btn primary" disabled={x.status==='approved'||busy} onClick={approve}>{x.status==='approved'?'Approved':'QA & Approve'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab==='rounds'&&(
          <>
            <div className="round-chips">
              {rounds.map(r=>(
                <button key={r.id} type="button" className={'round-chip'+(selectedRound?.id===r.id?' sel':'')} onClick={()=>loadAssigned(r)}>
                  R{r.round_number}
                  <em className={r.questions_locked?'locked':''}>{r.questions_locked?'Locked':r.status} · {allRQ.filter(x=>x.round_id===r.id).length}/3</em>
                </button>
              ))}
            </div>

            {!selectedRound&&<div className="empty">Select a round above to organise its 3 questions.</div>}

            {selectedRound&&(
              <>
                <h3 style={{margin:'0 0 4px'}}>Round {selectedRound.round_number} — {selectedRound.title}</h3>
                <p style={{margin:'0 0 12px',color:'#6b7280',fontSize:13}}>
                  {selectedRound.questions_locked?'Locked':'Unlocked'} · {assigned.length}/3 selected
                </p>

                <div className="actions" style={{marginBottom:12}}>
                  {!selectedRound.questions_locked&&(
                    <button className="btn primary" disabled={assigned.length!==3} onClick={lock}>Lock set (finalise)</button>
                  )}
                  {selectedRound.questions_locked&&(
                    <button className="btn danger" disabled={selectedRound.status!=='draft'} onClick={unlock}>Unlock to edit</button>
                  )}
                </div>

                {lastRemoved&&lastRemoved.roundId===selectedRound.id&&(
                  <div className="undo-bar">
                    <p><b>Removed:</b> {lastRemoved.stem}</p>
                    <button className="btn primary" type="button" disabled={selectedRound.questions_locked||assigned.length>=3} onClick={undoRemove}>Undo — put back</button>
                  </div>
                )}

                <div className="section-title">This round’s slots</div>
                {[1,2,3].map(n=>{
                  const a=assigned.find(x=>x.canonical_order===n);
                  const qq=a?q.find(x=>x.id===a.question_id):null;
                  return (
                    <div className={'slot'+(qq?' filled':'')} key={n}>
                      <header>
                        <div className="num">{n}</div>
                        {!selectedRound.questions_locked&&a&&(
                          <button type="button" className="btn danger" onClick={()=>remove(a.question_id)}>Remove</button>
                        )}
                      </header>
                      {qq?
                        <div>
                          <strong style={{fontSize:14,lineHeight:1.35}}>{qq.stem}</strong>
                          <small style={{display:'block',marginTop:6,color:'#6b7280'}}>{categoryName(qq.category_id)} · D{qq.difficulty}</small>
                        </div>
                        :<span style={{color:'#9ca3af',fontSize:13}}>Empty — add from Available below</span>}
                    </div>
                  );
                })}

                {!selectedRound.questions_locked&&assigned.length<3&&(
                  <>
                    <div className="section-title">Available to add ({availablePool.length})</div>
                    <input className="search" placeholder="Search available questions…" value={poolSearch} onChange={e=>setPoolSearch(e.target.value)}/>
                    {!availablePool.length&&<div className="empty">No free approved questions. Approve more in Bank, or free one from another round.</div>}
                    {availablePool.map(({q:x})=>(
                      <div className="avail-card" key={x.id}>
                        <div className="row">
                          <span className="badge free">Available</span>
                          <span className="badge">D{x.difficulty}</span>
                        </div>
                        <strong>{x.stem}</strong>
                        <small style={{color:'#6b7280'}}>{categoryName(x.category_id)}</small>
                        <button type="button" className="btn primary" onClick={()=>assign(x.id)}>Add to Round {selectedRound.round_number}</button>
                      </div>
                    ))}

                    {otherPool.length>0&&(
                      <>
                        <div className="section-title">Already used elsewhere</div>
                        {otherPool.map(({q:x,label,roundNumber})=>(
                          <div className="avail-card disabled" key={x.id}>
                            <div className="row">
                              <span className="badge used">
                                {label==='other-round'?`In Round ${roundNumber}`:label==='final'?'In Grand Final':'Used'}
                              </span>
                            </div>
                            <strong>{x.stem}</strong>
                            <small style={{color:'#6b7280'}}>Cannot add here until removed from that set</small>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab==='final'&&(
          <>
            <div className="actions" style={{marginBottom:14}}>
              <strong>{finalQ.length} / 10</strong>
              <button className="btn primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate Final</button>
            </div>
            {finalQ.map(x=>{
              const qq=q.find(y=>y.id===x.question_id);
              return (
                <div className="slot filled" key={x.question_id}>
                  <header><div className="num">{x.canonical_order}</div><button className="btn danger" onClick={()=>removeFinal(x.question_id)}>Remove</button></header>
                  <strong style={{fontSize:14}}>{qq?.stem??x.question_id}</strong>
                </div>
              );
            })}
            {finalQ.length<10&&(
              <>
                <div className="section-title">Add to final</div>
                {q.filter(x=>x.status==='approved'&&!finalQ.some(f=>f.question_id===x.id)&&!usageByQuestion.has(x.id)).map(x=>(
                  <div className="avail-card" key={x.id}>
                    <strong>{x.stem}</strong>
                    <button type="button" className="btn primary" onClick={()=>addFinal(x.id)}>Add to Final</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div></div>

      {tab==='bank'&&<button className="fab" onClick={openCreate}>+</button>}

      {modal&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}>
          <div className="modal">
            <div className="close-row"><h2>{modal==='create'?'New question':'Edit question'}</h2><button className="btn" onClick={()=>setModal(null)}>Close</button></div>
            {modal==='create'&&(
              <><label>AI topic</label><div className="row2"><input value={aiTopic} onChange={e=>setAiTopic(e.target.value)}/><button className="btn" disabled={busy||!aiTopic.trim()} onClick={generate}>Generate</button></div></>
            )}
            {formFields}
            <div className="modal-actions">
              <button className="btn primary" disabled={busy} onClick={modal==='create'?saveCreate:saveEdit}>{busy?'Saving…':modal==='create'?'Save draft':'Save'}</button>
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
