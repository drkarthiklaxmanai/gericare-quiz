import React,{useEffect,useMemo,useState}from'react';
import{createRoot}from'react-dom/client';
import{createClient}from'@supabase/supabase-js';
import'./styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const sb=url&&key?createClient(url,key):null;

type Tab='bank'|'create'|'rounds'|'final';
type Q={id:string;event_id:string;category_id:string|null;stem:string;status:string;difficulty:number;points:number;explanation:string|null;reference_text:string|null;created_at:string};
type R={id:string;event_id:string;round_number:number;title:string;status:string;questions_locked:boolean};
type C={id:string;name:string;slug:string};
type O={option_key:string;option_text:string;is_correct:boolean};
type FQ={question_id:string;canonical_order:number};

const blank=()=>({stem:'',category:'',difficulty:3,points:10,options:['','','',''],correct:0,explanation:'',references:[] as string[]});
const slug=(x:string)=>x.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

async function rpc(n:string,a:Record<string,unknown>={}){
  if(!sb)throw Error('Supabase environment not configured');
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
  const[selectedRound,setSelectedRound]=useState<R|null>(null);
  const[assigned,setAssigned]=useState<{question_id:string;canonical_order:number}[]>([]);
  const[finalQ,setFinalQ]=useState<FQ[]>([]);
  const[status,setStatus]=useState('Ready');
  const[draft,setDraft]=useState(blank());
  const[aiTopic,setAiTopic]=useState('');
  const[aiBusy,setAiBusy]=useState(false);
  const[mediaBusy,setMediaBusy]=useState(false);

  const resolveEvent=async()=>{
    if(configuredEvent){setEventId(configuredEvent);return configuredEvent}
    if(!sb)return'';
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
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(e.message))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';
  const filtered=useMemo(()=>q.filter(x=>(x.stem+' '+categoryName(x.category_id)+' '+x.status).toLowerCase().includes(search.toLowerCase())),[q,cats,search]);
  const approvedCount=q.filter(x=>x.status==='approved').length;
  const draftCount=q.filter(x=>x.status==='draft').length;

  const loadQuestion=async(x:Q)=>{
    setSel(x);
    setTab('bank');
    if(!sb)return;
    const{data,error}=await sb.from('question_options').select('option_key,option_text,is_correct').eq('question_id',x.id).order('option_key');
    if(error)setStatus(error.message);else setSelOpts(data??[]);
  };

  const ensureCategory=async(name:string)=>{
    if(!name.trim()||!sb)return null;
    const found=cats.find(c=>c.name.toLowerCase()===name.trim().toLowerCase());
    if(found)return found.id;
    const{data,error}=await sb.from('categories').insert({event_id:eventId,name:name.trim(),slug:slug(name)}).select('id,name,slug').single();
    if(error)throw error;
    setCats(v=>[...v,data]);
    return data.id;
  };

  const save=async()=>{
    try{
      if(!sb||!eventId)throw Error('Event not configured');
      if(!draft.stem.trim()||draft.options.some(x=>!x.trim()))throw Error('Stem and all four options are required');
      setStatus('Saving draft…');
      const category_id=await ensureCategory(draft.category);
      const{data:user}=await sb.auth.getUser();
      const{data:x,error}=await sb.from('questions').insert({event_id:eventId,category_id,stem:draft.stem,status:'draft',difficulty:draft.difficulty,points:draft.points,explanation:draft.explanation||null,reference_text:draft.references.join('\n')||null,created_by:user.user?.id??null,ai_metadata:aiTopic?{generated:true,topic:aiTopic}:{}}).select('id').single();
      if(error)throw error;
      const{error:oe}=await sb.from('question_options').insert(draft.options.map((option_text,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text,is_correct:i===draft.correct})));
      if(oe)throw oe;
      setDraft(blank());
      setAiTopic('');
      setStatus('Draft saved — open Bank to review');
      await load(eventId);
      setTab('bank');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const generate=async()=>{
    try{
      if(!sb||!eventId)throw Error('Event not configured');
      if(!aiTopic.trim())throw Error('Enter a topic');
      setAiBusy(true);
      setStatus('Generating with AI…');
      const{data,error}=await sb.functions.invoke('question-ai',{body:{action:'generate',event_id:eventId,topic:aiTopic,difficulty:draft.difficulty,category:draft.category||undefined}});
      if(error)throw error;
      if(data?.error)throw Error(data.message||data.detail||data.error);
      const d=data.draft;
      setDraft({stem:d.stem,category:d.category??draft.category,difficulty:d.difficulty,points:10,options:d.options,correct:d.correct_index,explanation:d.explanation,references:d.references??[]});
      setStatus('AI draft ready — review below, then Save');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}finally{setAiBusy(false)}
  };

  const approve=async()=>{
    if(!sel||!sb)return;
    try{
      setStatus('Running QA…');
      const correct=selOpts.findIndex(o=>o.is_correct);
      const{data:qa,error:qe}=await sb.functions.invoke('question-ai',{body:{action:'qa',event_id:eventId,stem:sel.stem,options:selOpts.map(o=>o.option_text),correct_index:correct,explanation:sel.explanation??'',difficulty:sel.difficulty,category:categoryName(sel.category_id)}});
      if(qe)throw qe;
      if(!qa?.pass)throw Error('QA failed: '+(qa?.flags??[]).map((f:any)=>f.message).join(' '));
      const{data:user}=await sb.auth.getUser();
      const{error}=await sb.from('questions').update({status:'approved',approved_by:user.user?.id??null,approved_at:new Date().toISOString()}).eq('id',sel.id);
      if(error)throw error;
      setStatus('Approved');
      await load(eventId);
      setSel({...sel,status:'approved'});
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const uploadMedia=async(file:File)=>{
    if(!sel||!sb||!eventId)return;
    try{
      setMediaBusy(true);
      setStatus('Uploading media…');
      const type=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':null;
      if(!type)throw Error('Unsupported media type');
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const path=`${eventId}/${sel.id}/${Date.now()}-${safe}`;
      const{error:ue}=await sb.storage.from('question-media').upload(path,file,{upsert:false,contentType:file.type});
      if(ue)throw ue;
      const{error:me}=await sb.from('question_media').insert({question_id:sel.id,media_type:type,storage_path:path,mime_type:file.type,metadata:{size:file.size},sort_order:0});
      if(me)throw me;
      setStatus('Media uploaded');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}finally{setMediaBusy(false)}
  };

  const loadAssigned=async(r:R)=>{
    setSelectedRound(r);
    if(!sb)return;
    const{data,error}=await sb.from('round_questions').select('question_id,canonical_order').eq('round_id',r.id).order('canonical_order');
    if(error)setStatus(error.message);else setAssigned(data??[]);
  };

  const assign=async(id:string)=>{
    if(!selectedRound)return;
    try{
      if(selectedRound.questions_locked)throw Error('Round question set is locked');
      if(assigned.length>=3)throw Error('Round already has 3 questions');
      setStatus('Assigning…');
      await rpc('assign_question_to_round',{p_round_id:selectedRound.id,p_question_id:id,p_canonical_order:assigned.length+1});
      await loadAssigned(selectedRound);
      setStatus('Question assigned to round');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const remove=async(id:string)=>{
    if(!selectedRound)return;
    try{
      setStatus('Removing…');
      await rpc('remove_question_from_round',{p_round_id:selectedRound.id,p_question_id:id});
      await loadAssigned(selectedRound);
      setStatus('Removed');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const lock=async()=>{
    if(!selectedRound)return;
    try{
      setStatus('Locking…');
      await rpc('lock_round_question_set',{p_round_id:selectedRound.id});
      setSelectedRound({...selectedRound,questions_locked:true});
      setStatus('3-question set locked');
      await load(eventId);
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const addFinal=async(id:string)=>{
    try{
      if(finalQ.length>=10)throw Error('Final already has 10 questions');
      setStatus('Adding to Final…');
      await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});
      await load(eventId);
      setStatus('Added to Grand Final');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const removeFinal=async(id:string)=>{
    try{
      setStatus('Removing from Final…');
      await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});
      await load(eventId);
      setStatus('Removed from Grand Final');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const validateFinal=async()=>{
    try{
      await rpc('validate_final_question_set',{p_event_id:eventId});
      setStatus('Grand Final valid: 10/10');
    }catch(e){setStatus(e instanceof Error?e.message:String(e))}
  };

  const goTab=(t:Tab)=>{
    setTab(t);
    if(t==='rounds'&&!selectedRound&&rounds[0])void loadAssigned(rounds[0]);
  };

  return(
    <div className="app">
      <header>
        <div className="header-top">
          <div>
            <small>GERiCARE • QUESTION MANAGEMENT</small>
            <h1>Question Editor</h1>
          </div>
          <span className="status">{status}</span>
        </div>
        <nav className="tabs" aria-label="Editor sections">
          <button type="button" className={'tab'+(tab==='bank'?' active':'')} onClick={()=>goTab('bank')}>Bank <span className="count-pill">{q.length}</span></button>
          <button type="button" className={'tab'+(tab==='create'?' active':'')} onClick={()=>goTab('create')}>Create / AI</button>
          <button type="button" className={'tab'+(tab==='rounds'?' active':'')} onClick={()=>goTab('rounds')}>Rounds</button>
          <button type="button" className={'tab'+(tab==='final'?' active':'')} onClick={()=>goTab('final')}>Grand Final <span className="count-pill">{finalQ.length}/10</span></button>
        </nav>
      </header>

      <main>
        {/* BANK */}
        <div className={'panel'+(tab==='bank'?' active':'')}>
          <div className="layout-bank">
            <aside>
              <div className="bar">
                <h3>Question Bank</h3>
                <p className="muted" style={{margin:'0 0 10px'}}>{approvedCount} approved · {draftCount} draft</p>
                <input placeholder="Search questions…" value={search} onChange={e=>setSearch(e.target.value)}/>
              </div>
              <div className="q-list">
                {filtered.length===0&&<div className="empty">No questions match.</div>}
                {filtered.map(x=>(
                  <button type="button" className={'q'+(sel?.id===x.id?' sel':'')} key={x.id} onClick={()=>loadQuestion(x)}>
                    <b><span className={'badge '+(x.status==='approved'?'approved':'draft')}>{x.status}</span></b>
                    <strong>{x.stem}</strong>
                    <small>{categoryName(x.category_id)} · D{x.difficulty} · {x.points} pts</small>
                  </button>
                ))}
              </div>
            </aside>

            <section>
              {!sel&&(
                <div className="card">
                  <h2>Review</h2>
                  <p className="muted">Select a question from the bank to review, approve, attach media, or assign to a round / Grand Final.</p>
                  <div className="builder-actions">
                    <button type="button" className="primary" onClick={()=>goTab('create')}>Create new question</button>
                  </div>
                </div>
              )}
              {sel&&(
                <div className="card">
                  <h2>Review Question</h2>
                  <div className="preview">
                    <small>STATUS</small>
                    <b><span className={'badge '+(sel.status==='approved'?'approved':'draft')}>{sel.status}</span></b>
                    <h3>{sel.stem}</h3>
                    {selOpts.map(o=>(
                      <p key={o.option_key}><strong>{o.option_key}.</strong> {o.option_text}{o.is_correct?' ✓':''}</p>
                    ))}
                    {sel.explanation&&<p>{sel.explanation}</p>}
                    <small>{categoryName(sel.category_id)} · Difficulty {sel.difficulty} · {sel.points} points</small>
                  </div>
                  <div className="builder-actions">
                    <button type="button" className="primary" onClick={approve} disabled={sel.status==='approved'}>
                      {sel.status==='approved'?'Approved':'Run QA & Approve'}
                    </button>
                    {sel.status==='approved'&&selectedRound&&(
                      <button type="button" onClick={()=>assign(sel.id)} disabled={selectedRound.questions_locked||assigned.some(a=>a.question_id===sel.id)}>
                        Add to Round {selectedRound.round_number}
                      </button>
                    )}
                    {sel.status==='approved'&&(
                      <button type="button" onClick={()=>addFinal(sel.id)} disabled={finalQ.some(x=>x.question_id===sel.id)||finalQ.length>=10}>
                        Add to Grand Final
                      </button>
                    )}
                    <label className="upload">
                      {mediaBusy?'Uploading…':'Upload image/video/audio'}
                      <input type="file" accept="image/*,video/mp4,audio/*" disabled={mediaBusy} onChange={e=>e.target.files?.[0]&&uploadMedia(e.target.files[0])}/>
                    </label>
                    <button type="button" className="ghost" onClick={()=>{setSel(null);setSelOpts([])}}>Clear selection</button>
                  </div>
                  {sel.status==='approved'&&!selectedRound&&(
                    <p className="muted" style={{marginTop:12}}>Tip: open the <button type="button" className="ghost" style={{padding:'2px 8px'}} onClick={()=>goTab('rounds')}>Rounds</button> tab and pick a round first, then return here to assign.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* CREATE / AI */}
        <div className={'panel'+(tab==='create'?' active':'')}>
          <div className="card">
            <h2>AI Draft Generator</h2>
            <p className="muted">Generate a draft, review it below, then save for human QA.</p>
            <div className="fields">
              <label>Topic / learning objective
                <input placeholder="e.g. Delirium prevention in hospitalised older adults" value={aiTopic} onChange={e=>setAiTopic(e.target.value)}/>
              </label>
              <div className="fields row">
                <label>Category
                  <input placeholder="e.g. Core Geriatrics" value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}/>
                </label>
                <label>Difficulty (1–5)
                  <input type="number" min={1} max={5} value={draft.difficulty} onChange={e=>setDraft({...draft,difficulty:+e.target.value})}/>
                </label>
              </div>
            </div>
            <button type="button" className="primary" disabled={aiBusy} onClick={generate}>{aiBusy?'Generating…':'Generate with AI'}</button>
          </div>

          <div className="card">
            <h2>Create / Edit Draft</h2>
            <textarea placeholder="Question stem" value={draft.stem} onChange={e=>setDraft({...draft,stem:e.target.value})}/>
            <div className="opts">
              {draft.options.map((o,i)=>(
                <div className="option" key={i}>
                  <input type="radio" name="correct" checked={draft.correct===i} onChange={()=>setDraft({...draft,correct:i})} title="Mark correct"/>
                  <input placeholder={`Option ${String.fromCharCode(65+i)}`} value={o} onChange={e=>{const z=[...draft.options];z[i]=e.target.value;setDraft({...draft,options:z})}}/>
                </div>
              ))}
            </div>
            <textarea placeholder="Explanation" value={draft.explanation} onChange={e=>setDraft({...draft,explanation:e.target.value})}/>
            {draft.references.length>0&&(
              <div className="preview">
                <small>AI-SUGGESTED REFERENCES — VERIFY BEFORE USE</small>
                {draft.references.map((r,i)=><p key={i}>{r}</p>)}
              </div>
            )}
            <div className="builder-actions">
              <button type="button" className="primary" onClick={save}>Save as Draft</button>
              <button type="button" className="ghost" onClick={()=>{setDraft(blank());setAiTopic('')}}>Clear form</button>
            </div>
          </div>
        </div>

        {/* ROUNDS */}
        <div className={'panel'+(tab==='rounds'?' active':'')}>
          <div className="card">
            <h2>Round Builder</h2>
            <p className="muted">Each preliminary round locks exactly 3 approved questions.</p>
            <div className="round-grid">
              {rounds.map(r=>(
                <button type="button" className={'round'+(selectedRound?.id===r.id?' sel':'')} key={r.id} onClick={()=>loadAssigned(r)}>
                  <b>R{r.round_number}</b>
                  <span>{r.title}</span>
                  <small>{r.status}</small>
                  <em>{r.questions_locked?'LOCKED':selectedRound?.id===r.id?`${assigned.length} / 3`:'Tap to select'}</em>
                </button>
              ))}
            </div>

            {selectedRound&&(
              <>
                <h3>{selectedRound.title} — selected questions</h3>
                {assigned.length===0&&<p className="muted">No questions yet. Approve items in Bank, then use “Add to Round”.</p>}
                {assigned.map(a=>(
                  <div className="assigned" key={a.question_id}>
                    <b>{a.canonical_order}</b>
                    <span>{q.find(x=>x.id===a.question_id)?.stem??a.question_id}</span>
                    <button type="button" onClick={()=>remove(a.question_id)} disabled={selectedRound.questions_locked}>Remove</button>
                  </div>
                ))}
                <div className="builder-actions">
                  <button type="button" className="primary" disabled={assigned.length!==3||selectedRound.questions_locked} onClick={lock}>
                    {selectedRound.questions_locked?'Locked':'Lock 3-question set'}
                  </button>
                  <button type="button" className="ghost" onClick={()=>goTab('bank')}>Browse bank to add</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* GRAND FINAL */}
        <div className={'panel'+(tab==='final'?' active':'')}>
          <div className="card">
            <h2>Grand Final Builder</h2>
            <p className="muted">Select 10 approved questions not reserved in preliminary rounds.</p>
            {finalQ.length===0&&<p className="muted">None selected yet. From Bank, open an approved question and tap “Add to Grand Final”.</p>}
            {finalQ.map(x=>(
              <div className="assigned" key={x.question_id}>
                <b>{x.canonical_order}</b>
                <span>{q.find(y=>y.id===x.question_id)?.stem??x.question_id}</span>
                <button type="button" onClick={()=>removeFinal(x.question_id)}>Remove</button>
              </div>
            ))}
            <div className="builder-actions">
              <strong>{finalQ.length} / 10 selected</strong>
              <button type="button" className="primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate 10-question Final</button>
              <button type="button" className="ghost" onClick={()=>goTab('bank')}>Browse bank</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
