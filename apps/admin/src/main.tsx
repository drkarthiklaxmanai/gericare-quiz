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
      const[a,b,c,d]=await Promise.all([
        sb.from('questions').select('id,event_id,category_id,stem,status,difficulty,points,explanation,reference_text,created_at').eq('event_id',eid).order('created_at',{ascending:false}),
        sb.from('rounds').select('id,event_id,round_number,title,status,questions_locked').eq('event_id',eid).order('round_number'),
        sb.from('categories').select('id,name,slug').eq('event_id',eid).order('name'),
        sb.from('final_questions').select('question_id,canonical_order').eq('event_id',eid).order('canonical_order'),
      ]);
      if(a.error||b.error||c.error||d.error)throw(a.error||b.error||c.error||d.error);
      setQ(a.data??[]);
      setRounds(b.data??[]);
      setCats(c.data??[]);
      setFinalQ(d.data??[]);
    }catch(e){setStatus(errText(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(errText(e)))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';

  const filtered=useMemo(()=>{
    return q.filter(x=>{
      if(filter!=='all'&&x.status!==filter)return false;
      const hay=(x.stem+' '+categoryName(x.category_id)).toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  },[q,cats,search,filter]);

  const loadQuestion=async(x:Q)=>{
    if(sel?.id===x.id){
      setSel(null);
      setSelOpts([]);
      return;
    }
    setSel(x);
    if(!sb)return;
    const{data,error}=await sb.from('question_options').select('option_key,option_text,is_correct').eq('question_id',x.id).order('option_key');
    if(error){setStatus(errText(error));setSelOpts([]);return}
    setSelOpts(data??[]);
  };

  const openEdit=(x:Q,opts:O[])=>{
    const ordered=['A','B','C','D'].map(k=>opts.find(o=>o.option_key===k)?.option_text??'');
    const correct=Math.max(0,opts.findIndex(o=>o.is_correct));
    setForm({
      stem:x.stem,
      category:categoryName(x.category_id)==='Uncategorised'?'':categoryName(x.category_id),
      difficulty:x.difficulty,
      points:x.points,
      options:ordered.length===4?ordered:[ordered[0]||'',ordered[1]||'',ordered[2]||'',ordered[3]||''],
      correct:correct>=0?correct:0,
      explanation:x.explanation??'',
    });
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
      const{data:x,error}=await sb.from('questions').insert({
        event_id:eventId,category_id,stem:form.stem.trim(),status:'draft',
        difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null,
        created_by:user.user?.id??null,ai_metadata:aiTopic?{generated:true,topic:aiTopic}:{},
      }).select('id').single();
      if(error)throw error;
      const{error:oe}=await sb.from('question_options').insert(
        form.options.map((option_text,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text:option_text.trim(),is_correct:i===form.correct}))
      );
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
      const{error}=await sb.from('questions').update({
        stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null,
      }).eq('id',sel.id);
      if(error)throw error;
      const{error:de}=await sb.from('question_options').delete().eq('question_id',sel.id);
      if(de)throw de;
      const{error:oe}=await sb.from('question_options').insert(
        form.options.map((option_text,i)=>({question_id:sel.id,option_key:String.fromCharCode(65+i),option_text:option_text.trim(),is_correct:i===form.correct}))
      );
      if(oe)throw oe;
      setModal(null);setStatus('Question updated');await load(eventId);
      const updated={...sel,stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null};
      await loadQuestion(updated);
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
    if(!sb)return;
    const{data,error}=await sb.from('round_questions').select('question_id,canonical_order').eq('round_id',r.id).order('canonical_order');
    if(error)setStatus(errText(error));else setAssigned(data??[]);
  };

  const assign=async(questionId:string)=>{
    if(!selectedRound)return;
    try{
      if(selectedRound.questions_locked)throw Error('Unlock the round first');
      if(assigned.length>=3)throw Error('Round already has 3 questions');
      setStatus('Assigning…');
      await rpc('assign_question_to_round',{p_round_id:selectedRound.id,p_question_id:questionId,p_canonical_order:assigned.length+1});
      await loadAssigned(selectedRound);setStatus('Question assigned');
    }catch(e){setStatus(errText(e))}
  };

  const remove=async(questionId:string)=>{
    if(!selectedRound)return;
    try{setStatus('Removing…');await rpc('remove_question_from_round',{p_round_id:selectedRound.id,p_question_id:questionId});await loadAssigned(selectedRound);setStatus('Removed')}catch(e){setStatus(errText(e))}
  };

  const lock=async()=>{
    if(!selectedRound)return;
    try{setStatus('Locking…');await rpc('lock_round_question_set',{p_round_id:selectedRound.id});setSelectedRound({...selectedRound,questions_locked:true});setStatus('Question set locked');await load(eventId)}catch(e){setStatus(errText(e))}
  };

  const unlock=async()=>{
    if(!selectedRound)return;
    try{setStatus('Unlocking…');await rpc('unlock_round_question_set',{p_round_id:selectedRound.id});setSelectedRound({...selectedRound,questions_locked:false});setStatus('Unlocked — you can reorganise');await load(eventId)}catch(e){setStatus(errText(e))}
  };

  const addFinal=async(id:string)=>{
    try{if(finalQ.length>=10)throw Error('Final already has 10 questions');setStatus('Adding to Final…');await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});await load(eventId);setStatus('Added to Grand Final')}catch(e){setStatus(errText(e))}
  };

  const removeFinal=async(id:string)=>{
    try{setStatus('Removing…');await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});await load(eventId);setStatus('Removed from Grand Final')}catch(e){setStatus(errText(e))}
  };

  const validateFinal=async()=>{
    try{await rpc('validate_final_question_set',{p_event_id:eventId});setStatus('Grand Final valid: 10/10')}catch(e){setStatus(errText(e))}
  };

  const approvedFree=useMemo(()=>{
    const used=new Set(assigned.map(a=>a.question_id));
    return q.filter(x=>x.status==='approved'&&!used.has(x.id));
  },[q,assigned]);

  const formFields=(
    <>
      <label>Question stem</label>
      <textarea value={form.stem} onChange={e=>setForm({...form,stem:e.target.value})} placeholder="Question text"/>
      <div className="row2">
        <div><label>Category</label><input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="e.g. Geriatrics"/></div>
        <div><label>Difficulty (1–5)</label><input type="number" min={1} max={5} value={form.difficulty} onChange={e=>setForm({...form,difficulty:+e.target.value})}/></div>
      </div>
      <label>Options (select correct)</label>
      <div className="opts">
        {form.options.map((o,i)=>(
          <div className="option" key={i}>
            <input type="radio" name="correct" checked={form.correct===i} onChange={()=>setForm({...form,correct:i})}/>
            <input value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e=>{const z=[...form.options];z[i]=e.target.value;setForm({...form,options:z})}}/>
          </div>
        ))}
      </div>
      <label>Explanation</label>
      <textarea value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})} placeholder="Optional explanation"/>
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

      <div className="panel">
        <div className="sheet">
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
                  return (
                    <div key={x.id} className={'qcard'+(open?' sel':'')}>
                      <button type="button" className="qcard-head" onClick={()=>loadQuestion(x)}>
                        <div className="meta">
                          <span className={'badge '+x.status}>{x.status}</span>
                          <span className="badge">D{x.difficulty}</span>
                        </div>
                        <strong>{x.stem}</strong>
                        <small>{categoryName(x.category_id)} · {x.points} pts</small>
                      </button>
                      {open&&(
                        <div className="qcard-body">
                          {selOpts.length===0&&<div className="empty" style={{padding:8}}>Loading options…</div>}
                          {selOpts.map(o=>(
                            <div key={o.option_key} className={'optline'+(o.is_correct?' ok':'')}>
                              <b>{o.option_key}</b><span>{o.option_text}</span>
                            </div>
                          ))}
                          {sel?.explanation&&<p className="expl">{sel.explanation}</p>}
                          <div className="actions">
                            <button type="button" className="btn primary" onClick={()=>openEdit(x,selOpts)}>Edit</button>
                            <button type="button" className="btn primary" disabled={x.status==='approved'||busy} onClick={approve}>
                              {x.status==='approved'?'Approved':'QA & Approve'}
                            </button>
                            {x.status==='approved'&&(
                              <button type="button" className="btn" disabled={finalQ.length>=10||finalQ.some(f=>f.question_id===x.id)} onClick={()=>addFinal(x.id)}>
                                Add to Final
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!filtered.length&&<div className="empty">No questions match.</div>}
              </div>
            </>
          )}

          {tab==='rounds'&&(
            <div className="rounds-layout">
              <div className="round-list">
                {rounds.map(r=>(
                  <button key={r.id} className={'round-btn'+(selectedRound?.id===r.id?' sel':'')} onClick={()=>loadAssigned(r)}>
                    <b>Round {r.round_number}</b>
                    <span>{r.title}</span>
                    <em className={r.questions_locked?'locked':r.status==='open'?'open':''}>{r.questions_locked?'Locked':r.status}</em>
                  </button>
                ))}
              </div>
              <div className="round-detail">
                {!selectedRound&&<div className="empty">Select a round to organise questions.</div>}
                {selectedRound&&(
                  <>
                    <h3>Round {selectedRound.round_number} — {selectedRound.title}</h3>
                    <p className="sub">Status: {selectedRound.status} · {selectedRound.questions_locked?'Locked':'Unlocked'} · {assigned.length}/3</p>
                    <div className="actions" style={{marginBottom:14}}>
                      {!selectedRound.questions_locked&&<button className="btn primary" disabled={assigned.length!==3} onClick={lock}>Lock 3-question set</button>}
                      {selectedRound.questions_locked&&<button className="btn danger" disabled={selectedRound.status!=='draft'} onClick={unlock}>Unlock</button>}
                    </div>
                    {[1,2,3].map(n=>{
                      const a=assigned.find(x=>x.canonical_order===n);
                      const qq=a?q.find(x=>x.id===a.question_id):null;
                      return (
                        <div className="slot" key={n}>
                          <header>
                            <div className="num">{n}</div>
                            {!selectedRound.questions_locked&&a&&<button className="btn danger" onClick={()=>remove(a.question_id)}>Remove</button>}
                          </header>
                          {qq?<div><strong style={{fontSize:14}}>{qq.stem}</strong><small style={{display:'block',marginTop:6,color:'#6b7280'}}>{categoryName(qq.category_id)} · D{qq.difficulty}</small></div>:<span className="empty" style={{padding:8}}>Empty slot</span>}
                        </div>
                      );
                    })}
                    {!selectedRound.questions_locked&&assigned.length<3&&(
                      <div className="picker">
                        <label style={{fontSize:12,fontWeight:700,color:'#6b7280'}}>Add approved question</label>
                        <select defaultValue="" onChange={e=>{if(e.target.value){void assign(e.target.value);e.target.value=''}}}>
                          <option value="">Choose…</option>
                          {approvedFree.map(x=><option key={x.id} value={x.id}>{x.stem.slice(0,80)}</option>)}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {tab==='final'&&(
            <div>
              <div className="actions" style={{marginBottom:14}}>
                <strong>{finalQ.length} / 10</strong>
                <button className="btn primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate Final</button>
              </div>
              {finalQ.map(x=>{
                const qq=q.find(y=>y.id===x.question_id);
                return (
                  <div className="slot" key={x.question_id}>
                    <header><div className="num">{x.canonical_order}</div><button className="btn danger" onClick={()=>removeFinal(x.question_id)}>Remove</button></header>
                    <strong style={{fontSize:14}}>{qq?.stem??x.question_id}</strong>
                  </div>
                );
              })}
              {finalQ.length<10&&(
                <div className="picker">
                  <select defaultValue="" onChange={e=>{if(e.target.value){void addFinal(e.target.value);e.target.value=''}}}>
                    <option value="">Add approved question…</option>
                    {q.filter(x=>x.status==='approved'&&!finalQ.some(f=>f.question_id===x.id)).map(x=><option key={x.id} value={x.id}>{x.stem.slice(0,80)}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {tab==='bank'&&<button className="fab" aria-label="Create question" onClick={openCreate}>+</button>}

      {modal&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}>
          <div className="modal" role="dialog">
            <div className="close-row">
              <h2>{modal==='create'?'New question':'Edit question'}</h2>
              <button className="btn" onClick={()=>setModal(null)}>Close</button>
            </div>
            {modal==='create'&&(
              <>
                <label>AI topic (optional)</label>
                <div className="row2">
                  <input value={aiTopic} onChange={e=>setAiTopic(e.target.value)} placeholder="Topic / learning objective"/>
                  <button className="btn" disabled={busy||!aiTopic.trim()} onClick={generate}>{busy?'…':'Generate with AI'}</button>
                </div>
              </>
            )}
            {formFields}
            <div className="modal-actions">
              <button className="btn primary" disabled={busy} onClick={modal==='create'?saveCreate:saveEdit}>{busy?'Saving…':modal==='create'?'Save as draft':'Save changes'}</button>
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
