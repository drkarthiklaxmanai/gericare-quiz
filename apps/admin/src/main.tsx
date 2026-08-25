import React,{useEffect,useMemo,useState}from'react';
import{createRoot}from'react-dom/client';
import{createClient}from'@supabase/supabase-js';
import'./styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const sb=url&&key?createClient(url,key):null;

type Q={id:string;event_id:string;category_id:string|null;stem:string;status:string;difficulty:number;points:number;explanation:string|null;reference_text:string|null;created_at:string};
type R={id:string;event_id:string;round_number:number;title:string;status:string;questions_locked:boolean};
type C={id:string;name:string;slug:string};
type O={option_key:string;option_text:string;is_correct:boolean};
type FQ={question_id:string;canonical_order:number};

const blank=()=>({stem:'',category:'',difficulty:3,points:10,options:['','','',''],correct:0,explanation:'',references:[] as string[]});
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
  if(!sb)throw Error('Supabase environment not configured');
  const{data,error}=await sb.rpc(n,a);
  if(error)throw error;
  return data;
}

function App(){
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
  const[editMode,setEditMode]=useState(false);
  const[edit,setEdit]=useState({stem:'',category:'',difficulty:3,points:10,options:['','','',''],correct:0,explanation:''});
  const[saveBusy,setSaveBusy]=useState(false);

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
    }catch(e){setStatus(errText(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(errText(e)))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';
  const filtered=useMemo(()=>q.filter(x=>(x.stem+' '+categoryName(x.category_id)).toLowerCase().includes(search.toLowerCase())),[q,cats,search]);

  const loadQuestion=async(x:Q)=>{
    setSel(x);
    setEditMode(false);
    if(!sb)return;
    const{data,error}=await sb.from('question_options').select('option_key,option_text,is_correct').eq('question_id',x.id).order('option_key');
    if(error){setStatus(errText(error));setSelOpts([]);return}
    const opts=data??[];
    setSelOpts(opts);
    const ordered=['A','B','C','D'].map(k=>opts.find(o=>o.option_key===k)?.option_text??'');
    const correct=Math.max(0,opts.findIndex(o=>o.is_correct));
    setEdit({
      stem:x.stem,
      category:categoryName(x.category_id)==='Uncategorised'?'':categoryName(x.category_id),
      difficulty:x.difficulty,
      points:x.points,
      options:ordered.length===4?ordered:[...ordered,''].slice(0,4),
      correct:correct>=0?correct:0,
      explanation:x.explanation??'',
    });
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
      const{data:x,error}=await sb.from('questions').insert({
        event_id:eventId,category_id,stem:draft.stem,status:'draft',difficulty:draft.difficulty,points:draft.points,
        explanation:draft.explanation||null,reference_text:draft.references.join('\n')||null,
        created_by:user.user?.id??null,ai_metadata:aiTopic?{generated:true,topic:aiTopic}:{},
      }).select('id').single();
      if(error)throw error;
      const{error:oe}=await sb.from('question_options').insert(
        draft.options.map((option_text,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text,is_correct:i===draft.correct}))
      );
      if(oe)throw oe;
      setDraft(blank());
      setAiTopic('');
      setStatus('Draft saved for human review');
      await load(eventId);
    }catch(e){setStatus(errText(e))}
  };

  const saveEdit=async()=>{
    if(!sel||!sb)return;
    try{
      if(!edit.stem.trim()||edit.options.some(x=>!x.trim()))throw Error('Stem and all four options are required');
      setSaveBusy(true);
      setStatus('Saving changes…');
      const category_id=await ensureCategory(edit.category);
      const{error}=await sb.from('questions').update({
        stem:edit.stem.trim(),
        category_id,
        difficulty:edit.difficulty,
        points:edit.points,
        explanation:edit.explanation.trim()||null,
      }).eq('id',sel.id);
      if(error)throw error;

      // Replace options (delete + insert keeps keys A–D consistent)
      const{error:de}=await sb.from('question_options').delete().eq('question_id',sel.id);
      if(de)throw de;
      const{error:oe}=await sb.from('question_options').insert(
        edit.options.map((option_text,i)=>({
          question_id:sel.id,
          option_key:String.fromCharCode(65+i),
          option_text:option_text.trim(),
          is_correct:i===edit.correct,
        }))
      );
      if(oe)throw oe;

      setStatus('Question updated');
      setEditMode(false);
      await load(eventId);
      const updated={...sel,stem:edit.stem.trim(),category_id,difficulty:edit.difficulty,points:edit.points,explanation:edit.explanation.trim()||null};
      await loadQuestion(updated);
    }catch(e){setStatus(errText(e))}
    finally{setSaveBusy(false)}
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
      setStatus('AI draft generated — review before saving');
    }catch(e){setStatus(errText(e))}
    finally{setAiBusy(false)}
  };

  const approve=async()=>{
    if(!sel||!sb)return;
    try{
      setStatus('Running QA…');
      const correct=selOpts.findIndex(o=>o.is_correct);
      const{data:qa,error:qe}=await sb.functions.invoke('question-ai',{body:{
        action:'qa',event_id:eventId,stem:sel.stem,options:selOpts.map(o=>o.option_text),
        correct_index:correct,explanation:sel.explanation??'',difficulty:sel.difficulty,category:categoryName(sel.category_id),
      }});
      if(qe)throw qe;
      if(!qa?.pass)throw Error('QA failed: '+(qa?.flags??[]).map((f:any)=>f.message).join(' '));
      const{data:user}=await sb.auth.getUser();
      const{error}=await sb.from('questions').update({status:'approved',approved_by:user.user?.id??null,approved_at:new Date().toISOString()}).eq('id',sel.id);
      if(error)throw error;
      setStatus('Approved');
      await load(eventId);
      setSel({...sel,status:'approved'});
    }catch(e){setStatus(errText(e))}
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
      setStatus('Media uploaded securely');
    }catch(e){setStatus(errText(e))}
    finally{setMediaBusy(false)}
  };

  const loadAssigned=async(r:R)=>{
    setSelectedRound(r);
    if(!sb)return;
    const{data,error}=await sb.from('round_questions').select('question_id,canonical_order').eq('round_id',r.id).order('canonical_order');
    if(error)setStatus(errText(error));
    else setAssigned(data??[]);
  };

  const assign=async(id:string)=>{
    if(!selectedRound)return;
    try{
      if(selectedRound.questions_locked)throw Error('Round question set is locked');
      if(assigned.length>=3)throw Error('Round already has 3 questions');
      setStatus('Assigning…');
      await rpc('assign_question_to_round',{p_round_id:selectedRound.id,p_question_id:id,p_canonical_order:assigned.length+1});
      await loadAssigned(selectedRound);
      setStatus('Question assigned');
    }catch(e){setStatus(errText(e))}
  };

  const remove=async(id:string)=>{
    if(!selectedRound)return;
    try{
      setStatus('Removing…');
      await rpc('remove_question_from_round',{p_round_id:selectedRound.id,p_question_id:id});
      await loadAssigned(selectedRound);
      setStatus('Removed');
    }catch(e){setStatus(errText(e))}
  };

  const lock=async()=>{
    if(!selectedRound)return;
    try{
      setStatus('Locking…');
      await rpc('lock_round_question_set',{p_round_id:selectedRound.id});
      setSelectedRound({...selectedRound,questions_locked:true});
      setStatus('3-question set locked');
      await load(eventId);
    }catch(e){setStatus(errText(e))}
  };

  const addFinal=async(id:string)=>{
    try{
      if(finalQ.length>=10)throw Error('Final already has 10 questions');
      setStatus('Adding to Final…');
      await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});
      await load(eventId);
      setStatus('Added to Grand Final');
    }catch(e){setStatus(errText(e))}
  };

  const removeFinal=async(id:string)=>{
    try{
      setStatus('Removing from Final…');
      await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});
      await load(eventId);
      setStatus('Removed from Grand Final');
    }catch(e){setStatus(errText(e))}
  };

  const validateFinal=async()=>{
    try{
      await rpc('validate_final_question_set',{p_event_id:eventId});
      setStatus('Grand Final question set is valid: 10/10');
    }catch(e){setStatus(errText(e))}
  };

  return (
    <div className="app">
      <header>
        <div><small>GERiCARE • QUESTION MANAGEMENT</small><h1>Question Editor</h1></div>
        <span>{status}</span>
      </header>
      <main>
        <aside>
          <div className="bar">
            <h3>Question Bank</h3>
            <input placeholder="Search questions…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          {filtered.map(x=>(
            <button className={'q '+(sel?.id===x.id?'sel':'')} key={x.id} onClick={()=>loadQuestion(x)}>
              <b>{x.status}</b>
              <strong>{x.stem}</strong>
              <small>{categoryName(x.category_id)} · D{x.difficulty} · {x.points} pts</small>
            </button>
          ))}
        </aside>
        <section>
          <div className="card">
            <h2>AI Draft Generator</h2>
            <div className="fields">
              <input placeholder="Topic / learning objective" value={aiTopic} onChange={e=>setAiTopic(e.target.value)}/>
              <input placeholder="Category" value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}/>
              <label>Difficulty <input type="number" min={1} max={5} value={draft.difficulty} onChange={e=>setDraft({...draft,difficulty:+e.target.value})}/></label>
            </div>
            <button className="primary" disabled={aiBusy} onClick={generate}>{aiBusy?'Generating…':'Generate with AI'}</button>
          </div>

          <div className="card">
            <h2>{sel?(editMode?'Edit Question':'Review Question'):'Create / Edit Draft'}</h2>

            {sel && editMode && (
              <>
                <textarea placeholder="Question stem" value={edit.stem} onChange={e=>setEdit({...edit,stem:e.target.value})}/>
                <div className="fields">
                  <input placeholder="Category" value={edit.category} onChange={e=>setEdit({...edit,category:e.target.value})}/>
                  <label>Difficulty <input type="number" min={1} max={5} value={edit.difficulty} onChange={e=>setEdit({...edit,difficulty:+e.target.value})}/></label>
                  <label>Points <input type="number" min={1} value={edit.points} onChange={e=>setEdit({...edit,points:+e.target.value})}/></label>
                </div>
                <div className="opts">
                  {edit.options.map((o,i)=>(
                    <div className="option" key={i}>
                      <input type="radio" checked={edit.correct===i} onChange={()=>setEdit({...edit,correct:i})}/>
                      <input placeholder={`Option ${String.fromCharCode(65+i)}`} value={o} onChange={e=>{
                        const z=[...edit.options];z[i]=e.target.value;setEdit({...edit,options:z});
                      }}/>
                    </div>
                  ))}
                </div>
                <textarea placeholder="Explanation" value={edit.explanation} onChange={e=>setEdit({...edit,explanation:e.target.value})}/>
                <div className="builder-actions">
                  <button className="primary" disabled={saveBusy} onClick={saveEdit}>{saveBusy?'Saving…':'Save changes'}</button>
                  <button onClick={()=>setEditMode(false)}>Cancel</button>
                </div>
              </>
            )}

            {sel && !editMode && (
              <>
                <div className="preview">
                  <small>STATUS</small>
                  <b>{sel.status}</b>
                  <h3>{sel.stem}</h3>
                  {selOpts.map(o=>(
                    <p key={o.option_key}><strong>{o.option_key}.</strong> {o.option_text}{o.is_correct?' ✓':''}</p>
                  ))}
                  <p>{sel.explanation}</p>
                  <small>{categoryName(sel.category_id)} · Difficulty {sel.difficulty} · {sel.points} points</small>
                </div>
                <div className="builder-actions">
                  <button className="primary" onClick={()=>setEditMode(true)}>Edit</button>
                  <button className="primary" onClick={approve} disabled={sel.status==='approved'}>{sel.status==='approved'?'Approved':'Run QA & Approve'}</button>
                  {selectedRound&&sel.status==='approved'&&(
                    <button onClick={()=>assign(sel.id)} disabled={selectedRound.questions_locked||assigned.some(a=>a.question_id===sel.id)}>
                      Add to Round {selectedRound.round_number}
                    </button>
                  )}
                  {sel.status==='approved'&&(
                    <button onClick={()=>addFinal(sel.id)} disabled={finalQ.some(x=>x.question_id===sel.id)||finalQ.length>=10}>
                      Add to Grand Final
                    </button>
                  )}
                  <label className="upload">
                    {mediaBusy?'Uploading…':'Upload image/video/audio'}
                    <input type="file" accept="image/*,video/mp4,audio/*" disabled={mediaBusy} onChange={e=>e.target.files?.[0]&&uploadMedia(e.target.files[0])}/>
                  </label>
                  <button onClick={()=>{setSel(null);setSelOpts([]);setEditMode(false)}}>New Draft</button>
                </div>
              </>
            )}

            {!sel && (
              <>
                <textarea placeholder="Question stem" value={draft.stem} onChange={e=>setDraft({...draft,stem:e.target.value})}/>
                <div className="opts">
                  {draft.options.map((o,i)=>(
                    <div className="option" key={i}>
                      <input type="radio" checked={draft.correct===i} onChange={()=>setDraft({...draft,correct:i})}/>
                      <input placeholder={`Option ${String.fromCharCode(65+i)}`} value={o} onChange={e=>{
                        const z=[...draft.options];z[i]=e.target.value;setDraft({...draft,options:z});
                      }}/>
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
                <button className="primary" onClick={save}>Save as Draft</button>
              </>
            )}
          </div>

          <div className="card">
            <h2>Round Builder</h2>
            {rounds.map(r=>(
              <button className={'round '+(selectedRound?.id===r.id?'sel':'')} key={r.id} onClick={()=>loadAssigned(r)}>
                <b>R{r.round_number}</b>
                <span>{r.title}</span>
                <small>{r.status}</small>
                <em>{r.questions_locked?'LOCKED':selectedRound?.id===r.id?`${assigned.length} / 3 selected`:'Select'}</em>
              </button>
            ))}
            {selectedRound&&(
              <>
                <h3>Selected questions</h3>
                {assigned.map(a=>(
                  <div className="assigned" key={a.question_id}>
                    <b>{a.canonical_order}</b>
                    <span>{q.find(x=>x.id===a.question_id)?.stem??a.question_id}</span>
                    <button onClick={()=>remove(a.question_id)} disabled={selectedRound.questions_locked}>Remove</button>
                  </div>
                ))}
                <div className="builder-actions">
                  <button className="primary" disabled={assigned.length!==3||selectedRound.questions_locked} onClick={lock}>
                    {selectedRound.questions_locked?'Locked':'Lock 3-question set'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2>Grand Final Builder</h2>
            <p className="muted">Select 10 approved questions not reserved in preliminary rounds.</p>
            {finalQ.map(x=>(
              <div className="assigned" key={x.question_id}>
                <b>{x.canonical_order}</b>
                <span>{q.find(y=>y.id===x.question_id)?.stem??x.question_id}</span>
                <button onClick={()=>removeFinal(x.question_id)}>Remove</button>
              </div>
            ))}
            <div className="builder-actions">
              <strong>{finalQ.length} / 10 selected</strong>
              <button className="primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate 10-question Final</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
