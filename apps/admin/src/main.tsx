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
  const[eventId,setEventId]=useState(configuredEvent??'');
  const[q,setQ]=useState<Q[]>([]);
  const[rounds,setRounds]=useState<R[]>([]);
  const[cats,setCats]=useState<C[]>([]);
  const[allRQ,setAllRQ]=useState<RQ[]>([]);
  const[finalQ,setFinalQ]=useState<FQ[]>([]);
  const[status,setStatus]=useState('Ready');
  const[sel,setSel]=useState<Q|null>(null);
  const[selOpts,setSelOpts]=useState<O[]>([]);
  const[optsCache,setOptsCache]=useState<Record<string,O[]>>({});
  const[search,setSearch]=useState('');
  const[filter,setFilter]=useState<'all'|'drafts'|'reserve'>('all');
  const[modal,setModal]=useState<'create'|'edit'|'import'|null>(null);
  const[form,setForm]=useState<Form>(emptyForm());
  const[aiTopic,setAiTopic]=useState('');
  const[busy,setBusy]=useState(false);
  const[lastRemoved,setLastRemoved]=useState<{kind:'round'|'final';roundId?:string;questionId:string;stem:string}|null>(null);
  const[assignTo,setAssignTo]=useState<string>('');
  type ImportRow={stem:string;options:string[];correct:number;explanation:string;category:string;difficulty:number;points:number;error?:string};
  const[importRows,setImportRows]=useState<ImportRow[]>([]);
  const[importPaste,setImportPaste]=useState('');
  const[importMsg,setImportMsg]=useState('');

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
      if(!assignTo&&rlist[0])setAssignTo(rlist[0].id);
    }catch(e){setStatus(errText(e))}
  };

  useEffect(()=>{resolveEvent().then(load).catch(e=>setStatus(errText(e)))},[]);

  const categoryName=(id:string|null)=>cats.find(c=>c.id===id)?.name??'Uncategorised';
  const assignedIds=useMemo(()=>new Set(allRQ.map(r=>r.question_id)),[allRQ]);
  const finalIds=useMemo(()=>new Set(finalQ.map(f=>f.question_id)),[finalQ]);
  const drafts=useMemo(()=>q.filter(x=>x.status==='draft'),[q]);
  const reserveList=useMemo(()=>q.filter(x=>x.status==='approved'&&!assignedIds.has(x.id)&&!finalIds.has(x.id)),[q,assignedIds,finalIds]);
  const countFor=(rid:string)=>allRQ.filter(r=>r.round_id===rid).length;

  const slotsFor=(round:R)=>{
    const m=new Map(allRQ.filter(r=>r.round_id===round.id).map(r=>[r.canonical_order,r.question_id]));
    return [m.get(1)??null,m.get(2)??null,m.get(3)??null] as (string|null)[];
  };

  const loadOpts=async(questionId:string)=>{
    if(optsCache[questionId]||!sb)return optsCache[questionId]??[];
    const{data,error}=await sb.from('question_options').select('option_key,option_text,is_correct').eq('question_id',questionId).order('option_key');
    if(error){setStatus(errText(error));return []}
    const opts=data??[];
    setOptsCache(c=>({...c,[questionId]:opts}));
    return opts;
  };

  const toggleCard=async(x:Q)=>{
    if(sel?.id===x.id){setSel(null);setSelOpts([]);return}
    setSel(x);
    setSelOpts(optsCache[x.id]??await loadOpts(x.id));
  };

  const setRoundOrder=async(round:R,ordered:string[])=>{
    if(round.questions_locked)throw Error('Unlock this round first');
    if(ordered.length>3)throw Error('Max 3 questions');
    const current=allRQ.filter(r=>r.round_id===round.id);
    for(const row of current)await rpc('remove_question_from_round',{p_round_id:round.id,p_question_id:row.question_id});
    for(let i=0;i<ordered.length;i++)await rpc('assign_question_to_round',{p_round_id:round.id,p_question_id:ordered[i],p_canonical_order:i+1});
    await load(eventId);
  };

  const addToRoundId=async(round:R,questionId:string)=>{
    const ordered=slotsFor(round).filter(Boolean) as string[];
    if(ordered.length>=3)throw Error(`Round ${round.round_number} is full`);
    if(ordered.includes(questionId))return;
    await setRoundOrder(round,[...ordered,questionId]);
  };

  const removeFromRoundId=async(round:R,questionId:string)=>{
    const qq=q.find(x=>x.id===questionId);
    if(!window.confirm(`Move to Reserve?\n\n${qq?.stem??''}`))return;
    try{
      await setRoundOrder(round,(slotsFor(round).filter(Boolean) as string[]).filter(id=>id!==questionId));
      setLastRemoved({kind:'round',roundId:round.id,questionId,stem:qq?.stem??questionId});
      setStatus('Moved to Reserve');
    }catch(e){setStatus(errText(e))}
  };

  const moveInRound=async(round:R,index:number,dir:-1|1)=>{
    const ordered=[...slotsFor(round)];
    const j=index+dir;
    if(j<0||j>2||!ordered[index])return;
    const t=ordered[index];ordered[index]=ordered[j];ordered[j]=t;
    try{await setRoundOrder(round,ordered.filter(Boolean) as string[]);setStatus('Order updated')}catch(e){setStatus(errText(e))}
  };

  const lockRound=async(round:R)=>{
    try{await rpc('lock_round_question_set',{p_round_id:round.id});setStatus(`R${round.round_number} locked`);await load(eventId)}catch(e){setStatus(errText(e))}
  };
  const unlockRound=async(round:R)=>{
    try{await rpc('unlock_round_question_set',{p_round_id:round.id});setStatus(`R${round.round_number} unlocked`);await load(eventId)}catch(e){setStatus(errText(e))}
  };

  const addFinal=async(id:string)=>{
    try{
      if(finalQ.length>=10)throw Error('Final full');
      await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:id,p_canonical_order:finalQ.length+1});
      if(lastRemoved?.questionId===id)setLastRemoved(null);
      await load(eventId);setStatus('Added to Final');
    }catch(e){setStatus(errText(e))}
  };

  const removeFinal=async(id:string)=>{
    const qq=q.find(x=>x.id===id);
    if(!window.confirm(`Move to Reserve?\n\n${qq?.stem??''}`))return;
    try{
      await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:id});
      setLastRemoved({kind:'final',questionId:id,stem:qq?.stem??id});
      await load(eventId);setStatus('Moved to Reserve');
    }catch(e){setStatus(errText(e))}
  };

  const moveFinal=async(index:number,dir:-1|1)=>{
    const j=index+dir;
    if(j<0||j>=finalQ.length)return;
    try{
      const ids=finalQ.map(f=>f.question_id);
      const t=ids[index];ids[index]=ids[j];ids[j]=t;
      const{data:cur}=await sb!.from('final_questions').select('question_id').eq('event_id',eventId);
      for(const row of cur??[])await rpc('remove_question_from_final',{p_event_id:eventId,p_question_id:row.question_id});
      for(let i=0;i<ids.length;i++)await rpc('assign_question_to_final',{p_event_id:eventId,p_question_id:ids[i],p_canonical_order:i+1});
      await load(eventId);setStatus('Final order updated');
    }catch(e){setStatus(errText(e))}
  };

  const validateFinal=async()=>{try{await rpc('validate_final_question_set',{p_event_id:eventId});setStatus('Final OK 10/10')}catch(e){setStatus(errText(e))}};

  const undo=async()=>{
    if(!lastRemoved)return;
    try{
      if(lastRemoved.kind==='final'){await addFinal(lastRemoved.questionId);return}
      const r=rounds.find(x=>x.id===lastRemoved.roundId);
      if(!r)return;
      await addToRoundId(r,lastRemoved.questionId);
      setLastRemoved(null);
      setStatus('Restored');
    }catch(e){setStatus(errText(e))}
  };

  const assignReserve=async(questionId:string)=>{
    try{
      if(!assignTo)throw Error('Choose a destination');
      if(assignTo==='final'){await addFinal(questionId);return}
      const r=rounds.find(x=>x.id===assignTo);
      if(!r)throw Error('Round not found');
      setStatus('Adding…');
      await addToRoundId(r,questionId);
      setStatus(`Added to R${r.round_number}`);
    }catch(e){setStatus(errText(e))}
  };

  const openEdit=(x:Q,opts:O[])=>{
    const ordered=['A','B','C','D'].map(k=>opts.find(o=>o.option_key===k)?.option_text??'');
    const correct=Math.max(0,opts.findIndex(o=>o.is_correct));
    setForm({stem:x.stem,category:categoryName(x.category_id)==='Uncategorised'?'':categoryName(x.category_id),difficulty:x.difficulty,points:x.points,options:ordered,correct:correct>=0?correct:0,explanation:x.explanation??''});
    setSel(x);setSelOpts(opts);setModal('edit');
  };
  const openCreate=()=>{setForm(emptyForm());setAiTopic('');setModal('create')};
  const openImport=()=>{setImportRows([]);setImportPaste('');setImportMsg('');setModal('import')};

  function splitDelimited(text:string):string[][]{
    const rows:string[][]=[];
    let row:string[]=[];
    let cur='';
    let i=0;
    let inQ=false;
    const s=text.replace(/^\uFEFF/,'');
    while(i<s.length){
      const c=s[i];
      if(inQ){
        if(c==='"'){
          if(s[i+1]==='"'){cur+='"';i+=2;continue}
          inQ=false;i++;continue;
        }
        cur+=c;i++;continue;
      }
      if(c==='"'){inQ=true;i++;continue}
      if(c===','||c==='\t'){row.push(cur);cur='';i++;continue}
      if(c==='\r'){i++;continue}
      if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';i++;continue}
      cur+=c;i++;
    }
    if(cur.length||row.length){row.push(cur);rows.push(row)}
    return rows.filter(r=>r.some(cell=>String(cell).trim().length>0));
  }

  function normalizeHeader(h:string){
    return h.trim().toLowerCase().replace(/[\s\-]+/g,'_').replace(/[^a-z0-9_]/g,'');
  }

  function parseCorrect(v:string):number{
    const s=String(v??'').trim().toUpperCase();
    if(['A','1'].includes(s))return 0;
    if(['B','2'].includes(s))return 1;
    if(['C','3'].includes(s))return 2;
    if(['D','4'].includes(s))return 3;
    return -1;
  }

  function rowsFromTable(table:string[][]):ImportRow[]{
    if(!table.length)return [];
    const headers=table[0].map(normalizeHeader);
    const idx=(...names:string[])=>{
      for(const n of names){const i=headers.indexOf(n);if(i>=0)return i}
      return -1;
    };
    const iStem=idx('stem','question','question_stem','q');
    const iA=idx('option_a','a','optiona','choice_a');
    const iB=idx('option_b','b','optionb','choice_b');
    const iC=idx('option_c','c','optionc','choice_c');
    const iD=idx('option_d','d','optiond','choice_d');
    const iCorrect=idx('correct','correct_option','answer','correct_answer','key');
    const iExpl=idx('explanation','explain','rationale');
    const iCat=idx('category','topic','specialty');
    const iDiff=idx('difficulty','diff','level');
    const iPts=idx('points','point','score');
    const hasHeader=iStem>=0||(headers[0]&&['stem','question','q'].includes(headers[0]));
    const out:ImportRow[]=[];
    const start=hasHeader?1:0;
    for(let r=start;r<table.length;r++){
      const cells=table[r];
      const get=(i:number)=>i>=0?(cells[i]??''):'';
      let stem,opts,correctRaw,expl,cat,diff,pts;
      if(hasHeader&&iStem>=0){
        stem=String(get(iStem)).trim();
        opts=[String(get(iA)).trim(),String(get(iB)).trim(),String(get(iC)).trim(),String(get(iD)).trim()];
        correctRaw=String(get(iCorrect)).trim();
        expl=String(get(iExpl)).trim();
        cat=String(get(iCat)).trim();
        diff=Number(get(iDiff))||3;
        pts=Number(get(iPts))||10;
      }else{
        stem=String(cells[0]??'').trim();
        opts=[String(cells[1]??'').trim(),String(cells[2]??'').trim(),String(cells[3]??'').trim(),String(cells[4]??'').trim()];
        correctRaw=String(cells[5]??'').trim();
        expl=String(cells[6]??'').trim();
        cat=String(cells[7]??'').trim();
        diff=Number(cells[8])||3;
        pts=Number(cells[9])||10;
      }
      const correct=parseCorrect(correctRaw);
      const row:ImportRow={stem,options:opts,correct,explanation:expl,category:cat,difficulty:Math.min(5,Math.max(1,diff)),points:pts};
      if(!stem)row.error='Missing stem';
      else if(opts.some(o=>!o))row.error='All 4 options required';
      else if(correct<0)row.error='correct must be A/B/C/D (or 1–4)';
      out.push(row);
    }
    return out;
  }

  const applyImportText=(text:string)=>{
    try{
      const table=splitDelimited(text);
      const rows=rowsFromTable(table);
      setImportRows(rows);
      const bad=rows.filter(r=>r.error).length;
      setImportMsg(rows.length?`${rows.length} row(s) parsed${bad?` · ${bad} with errors`:''}`:'No rows found');
    }catch(e){setImportMsg(errText(e));setImportRows([])}
  };

  const onImportFile=async(file:File)=>{
    const name=file.name.toLowerCase();
    if(name.endsWith('.xlsx')||name.endsWith('.xls')){
      setImportMsg('Excel binary (.xlsx) is not parsed in-browser. In Excel: File → Save As → CSV UTF-8, then upload that file. Or copy the sheet and paste below.');
      return;
    }
    const text=await file.text();
    applyImportText(text);
  };

  const downloadTemplate=()=>{
    const header='stem,option_a,option_b,option_c,option_d,correct,explanation,category,difficulty,points';
    const sample='"Which of the following is first-line for agitation in delirium when non-drug measures fail?","Haloperidol","Diazepam","Amitriptyline","Diphenhydramine",A,"Low-dose haloperidol is preferred; avoid benzodiazepines except alcohol withdrawal.",Delirium,3,10';
    const blob=new Blob([header+'\n'+sample+'\n'],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='gericare-question-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
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

  const runBulkImport=async()=>{
    const valid=importRows.filter(r=>!r.error);
    if(!valid.length){setImportMsg('No valid rows to import');return}
    try{
      setBusy(true);
      setImportMsg(`Importing ${valid.length} draft(s)…`);
      const{data:user}=await sb!.auth.getUser();
      let ok=0;
      for(const row of valid){
        const category_id=await ensureCategory(row.category);
        const{data:x,error}=await sb!.from('questions').insert({
          event_id:eventId,category_id,stem:row.stem,status:'draft',
          difficulty:row.difficulty,points:row.points,
          explanation:row.explanation||null,created_by:user.user?.id??null
        }).select('id').single();
        if(error)throw error;
        const{error:oe}=await sb!.from('question_options').insert(
          row.options.map((t,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text:t,is_correct:i===row.correct}))
        );
        if(oe)throw oe;
        ok++;
      }
      setStatus(`Imported ${ok} draft question(s)`);
      setModal(null);setImportRows([]);setImportPaste('');
      await load(eventId);
      setFilter('drafts');
    }catch(e){setImportMsg(errText(e));setStatus(errText(e))}
    finally{setBusy(false)}
  };

  const saveCreate=async()=>{
    try{
      if(!form.stem.trim()||form.options.some(o=>!o.trim()))throw Error('Stem and 4 options required');
      setBusy(true);
      const category_id=await ensureCategory(form.category);
      const{data:user}=await sb!.auth.getUser();
      const{data:x,error}=await sb!.from('questions').insert({event_id:eventId,category_id,stem:form.stem.trim(),status:'draft',difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null,created_by:user.user?.id??null}).select('id').single();
      if(error)throw error;
      await sb!.from('question_options').insert(form.options.map((t,i)=>({question_id:x.id,option_key:String.fromCharCode(65+i),option_text:t.trim(),is_correct:i===form.correct})));
      setModal(null);setStatus('Draft saved');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const saveEdit=async()=>{
    if(!sel)return;
    try{
      setBusy(true);
      const category_id=await ensureCategory(form.category);
      await sb!.from('questions').update({stem:form.stem.trim(),category_id,difficulty:form.difficulty,points:form.points,explanation:form.explanation.trim()||null}).eq('id',sel.id);
      await sb!.from('question_options').delete().eq('question_id',sel.id);
      const opts=form.options.map((t,i)=>({question_id:sel.id,option_key:String.fromCharCode(65+i),option_text:t.trim(),is_correct:i===form.correct}));
      await sb!.from('question_options').insert(opts);
      setOptsCache(c=>({...c,[sel.id]:opts.map(o=>({option_key:o.option_key,option_text:o.option_text,is_correct:o.is_correct}))}));
      setModal(null);setStatus('Saved');await load(eventId);
    }catch(e){setStatus(errText(e))}finally{setBusy(false)}
  };

  const approve=async(x?:Q)=>{
    const target=x??sel;
    if(!target||!sb)return;
    try{
      setBusy(true);
      let opts=optsCache[target.id]??selOpts;
      if(!opts.length)opts=await loadOpts(target.id);
      const correct=opts.findIndex(o=>o.is_correct);
      const{data:qa,error:qe}=await sb.functions.invoke('question-ai',{body:{action:'qa',event_id:eventId,stem:target.stem,options:opts.map(o=>o.option_text),correct_index:correct,explanation:target.explanation??'',difficulty:target.difficulty,category:categoryName(target.category_id)}});
      if(qe)throw qe;
      if(!qa?.pass)throw Error('QA failed');
      const{data:user}=await sb.auth.getUser();
      await sb.from('questions').update({status:'approved',approved_by:user.user?.id??null,approved_at:new Date().toISOString()}).eq('id',target.id);
      setStatus('Approved');await load(eventId);
      if(sel?.id===target.id)setSel({...target,status:'approved'});
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

  const matchSearch=(stem:string)=>!search.trim()||stem.toLowerCase().includes(search.toLowerCase());

  type CardCtx=
    |{kind:'round';round:R;index:number;total:number}
    |{kind:'final';index:number;total:number}
    |{kind:'reserve'}
    |{kind:'draft'};

  const QuestionCard=({x,badge,ctx}:{x:Q;badge?:string;ctx:CardCtx})=>{
    const open=sel?.id===x.id;
    const opts=open?(optsCache[x.id]??selOpts):[];
    const locked=ctx.kind==='round'&&ctx.round.questions_locked;
    return (
      <div className="qrow">
        <button type="button" className="qrow-h" onClick={()=>toggleCard(x)}>
          <span className={'badge '+(x.status==='approved'?'ok':'warn')}>{x.status}</span>
          {badge&&<span className="badge">{badge}</span>}
          <span className="badge">D{x.difficulty}</span>
          <strong style={{display:'block',marginTop:6,fontSize:13,lineHeight:1.35}}>{x.stem}</strong>
          <div style={{fontSize:11,color:'#6b7280',marginTop:4}}>{categoryName(x.category_id)}</div>
        </button>
        {open&&(
          <div className="qrow-b">
            {!opts.length&&<div className="empty" style={{padding:8}}>Loading options…</div>}
            {opts.map(o=>(
              <div key={o.option_key} className={'optline'+(o.is_correct?' ok':'')}>
                <b>{o.option_key}.</b> {o.option_text}{o.is_correct?' ✓':''}
              </div>
            ))}
            {x.explanation&&<p style={{fontSize:12,color:'#4b5563',margin:'8px 0 0'}}>{x.explanation}</p>}
            <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
              <button type="button" className="btn primary" onClick={()=>openEdit(x,opts)}>Edit</button>
              <button type="button" className="btn primary" disabled={x.status==='approved'||busy} onClick={()=>approve(x)}>
                {x.status==='approved'?'Approved':'QA & Approve'}
              </button>
            </div>
            {ctx.kind==='round'&&!locked&&(
              <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                <button type="button" className="btn icon" disabled={ctx.index<=0} onClick={()=>moveInRound(ctx.round,ctx.index,-1)}>↑</button>
                <button type="button" className="btn icon" disabled={ctx.index>=ctx.total-1} onClick={()=>moveInRound(ctx.round,ctx.index,1)}>↓</button>
                <button type="button" className="btn danger" onClick={()=>removeFromRoundId(ctx.round,x.id)}>Remove to Reserve</button>
              </div>
            )}
            {ctx.kind==='round'&&locked&&(
              <p style={{fontSize:12,color:'#9ca3af',margin:'8px 0 0'}}>Locked — use Unlock on the section header</p>
            )}
            {ctx.kind==='final'&&(
              <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                <button type="button" className="btn icon" disabled={ctx.index<=0} onClick={()=>moveFinal(ctx.index,-1)}>↑</button>
                <button type="button" className="btn icon" disabled={ctx.index>=ctx.total-1} onClick={()=>moveFinal(ctx.index,1)}>↓</button>
                <button type="button" className="btn danger" onClick={()=>removeFinal(x.id)}>Remove to Reserve</button>
              </div>
            )}
            {ctx.kind==='reserve'&&(
              <div style={{marginTop:10}}>
                <label style={{fontSize:11,fontWeight:700,color:'#6b7280'}}>Add to</label>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  <select value={assignTo} onChange={e=>setAssignTo(e.target.value)} style={{font:'inherit',padding:'8px 10px',borderRadius:10,border:'1px solid #d1d5db',flex:'1 1 140px'}}>
                    {rounds.map(r=>(
                      <option key={r.id} value={r.id} disabled={r.questions_locked||countFor(r.id)>=3}>
                        R{r.round_number} ({countFor(r.id)}/3){r.questions_locked?' locked':''}
                      </option>
                    ))}
                    <option value="final" disabled={finalQ.length>=10}>Final ({finalQ.length}/10)</option>
                  </select>
                  <button type="button" className="btn primary" onClick={()=>assignReserve(x.id)}>Add</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <div><small>GeriCare</small><h1>Question bank</h1></div>
        <div className="pill">{status}</div>
      </header>

      <div className="wrap"><div className="card">
        <input className="search" placeholder="Search questions…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="filters">
          <button type="button" className={'btn'+(filter==='all'?' primary':'')} onClick={()=>setFilter('all')}>All sections</button>
          <button type="button" className={'btn'+(filter==='drafts'?' primary':'')} onClick={()=>setFilter('drafts')}>Drafts ({drafts.length})</button>
          <button type="button" className={'btn'+(filter==='reserve'?' primary':'')} onClick={()=>setFilter('reserve')}>Reserve ({reserveList.length})</button>
          <button type="button" className="btn" onClick={openImport}>Bulk import</button>
        </div>

        {lastRemoved&&(
          <div className="undo">
            <p><b>Removed:</b> {lastRemoved.stem}</p>
            <button type="button" className="btn primary" onClick={undo}>Undo</button>
          </div>
        )}

        {(filter==='all'||filter==='drafts')&&drafts.filter(x=>matchSearch(x.stem)).length>0&&(
          <div className="section">
            <div className="section-head">
              <div>
                <h3>Drafts</h3>
                <p>{drafts.length} need approve</p>
              </div>
            </div>
            {drafts.filter(x=>matchSearch(x.stem)).map(x=>(
              <QuestionCard key={x.id} x={x} badge="needs approve" ctx={{kind:'draft'}}/>
            ))}
          </div>
        )}

        {filter==='all'&&rounds.map(r=>{
          const rows=allRQ.filter(row=>row.round_id===r.id).sort((a,b)=>a.canonical_order-b.canonical_order);
          if(search&&!rows.some(row=>{const x=q.find(qq=>qq.id===row.question_id);return x&&matchSearch(x.stem)}))return null;
          return (
            <div className="section" key={r.id}>
              <div className="section-head">
                <div>
                  <h3>Round {r.round_number} — {r.title}</h3>
                  <p>
                    {rows.length}/3 · {r.questions_locked?'Locked':r.status}
                    {r.questions_locked&&<> · <span className="badge lock">locked</span></>}
                  </p>
                </div>
                <div className="actions">
                  {!r.questions_locked&&(
                    <button type="button" className="btn primary" disabled={rows.length!==3} onClick={()=>lockRound(r)}>Lock</button>
                  )}
                  {r.questions_locked&&(
                    <button type="button" className="btn danger" disabled={r.status!=='draft'} onClick={()=>unlockRound(r)}>Unlock</button>
                  )}
                </div>
              </div>
              {!rows.length&&<div className="empty" style={{padding:10}}>Empty — add from Reserve</div>}
              {rows.map((row,index)=>{
                const x=q.find(qq=>qq.id===row.question_id);
                if(!x||!matchSearch(x.stem))return null;
                return (
                  <QuestionCard
                    key={x.id}
                    x={x}
                    badge={`#${row.canonical_order}`}
                    ctx={{kind:'round',round:r,index,total:rows.length}}
                  />
                );
              })}
            </div>
          );
        })}

        {filter==='all'&&(
          <div className="section">
            <div className="section-head">
              <div>
                <h3>Grand Final</h3>
                <p>{finalQ.length}/10</p>
              </div>
              <div className="actions">
                <button type="button" className="btn primary" disabled={finalQ.length!==10} onClick={validateFinal}>Validate</button>
              </div>
            </div>
            {!finalQ.length&&<div className="empty" style={{padding:10}}>None yet</div>}
            {finalQ.map((f,index)=>{
              const x=q.find(qq=>qq.id===f.question_id);
              if(!x||!matchSearch(x.stem))return null;
              return (
                <QuestionCard
                  key={x.id}
                  x={x}
                  badge={`#${f.canonical_order}`}
                  ctx={{kind:'final',index,total:finalQ.length}}
                />
              );
            })}
          </div>
        )}

        {(filter==='all'||filter==='reserve')&&(
          <div className="section">
            <div className="section-head">
              <div>
                <h3>Reserve</h3>
                <p>{reserveList.length} free approved</p>
              </div>
            </div>
            <p className="hint">Open a card → choose round or Final → Add</p>
            {reserveList.filter(x=>matchSearch(x.stem)).map(x=>(
              <QuestionCard key={x.id} x={x} badge="free" ctx={{kind:'reserve'}}/>
            ))}
            {!reserveList.filter(x=>matchSearch(x.stem)).length&&<div className="empty">No free questions</div>}
          </div>
        )}
      </div></div>

      <button type="button" className="fab" onClick={openCreate} aria-label="New question">+</button>

      {modal&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}>
          <div className={'modal'+(modal==='import'?' modal-wide':'')}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
              <h2>{modal==='import'?'Bulk import':modal==='create'?'New question':'Edit'}</h2>
              <button type="button" className="btn" onClick={()=>setModal(null)}>Close</button>
            </div>

            {modal==='import'&&(
              <>
                <p className="hint" style={{marginTop:10}}>
                  Import drafts from <b>CSV</b> (Excel → Save As → CSV UTF-8) or paste cells copied from <b>Google Sheets</b>.
                  Questions land in <b>Drafts</b>; use QA & Approve before assigning to rounds.
                </p>
                <div className="import-actions">
                  <button type="button" className="btn" onClick={downloadTemplate}>Download template</button>
                  <label className="btn file-btn">
                    Upload CSV
                    <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void onImportFile(f);e.target.value=''}}/>
                  </label>
                </div>
                <label>Or paste from Google Sheets / Excel</label>
                <textarea
                  className="import-paste"
                  placeholder={'stem\toption_a\toption_b\toption_c\toption_d\tcorrect\texplanation\tcategory\tdifficulty\tpoints\nPaste rows here…'}
                  value={importPaste}
                  onChange={e=>setImportPaste(e.target.value)}
                />
                <div className="import-actions">
                  <button type="button" className="btn" disabled={!importPaste.trim()} onClick={()=>applyImportText(importPaste)}>Parse paste</button>
                </div>
                {importMsg&&<p className="import-msg">{importMsg}</p>}
                {importRows.length>0&&(
                  <div className="import-preview">
                    <div className="import-preview-head">
                      <span>Preview</span>
                      <span>{importRows.filter(r=>!r.error).length} valid · {importRows.filter(r=>r.error).length} errors</span>
                    </div>
                    {importRows.slice(0,40).map((r,i)=>(
                      <div key={i} className={'import-row'+(r.error?' bad':'')}>
                        <b>#{i+1}</b>
                        <div>
                          <div className="import-stem">{r.stem||'(empty stem)'}</div>
                          <div className="import-meta">
                            {r.error?r.error:`Correct ${String.fromCharCode(65+r.correct)} · D${r.difficulty} · ${r.points} pts${r.category?` · ${r.category}`:''}`}
                          </div>
                        </div>
                      </div>
                    ))}
                    {importRows.length>40&&<p className="hint">Showing first 40 of {importRows.length}</p>}
                  </div>
                )}
                <div style={{marginTop:14,display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy||!importRows.some(r=>!r.error)}
                    onClick={()=>void runBulkImport()}
                  >
                    {busy?'Importing…':`Import ${importRows.filter(r=>!r.error).length} as drafts`}
                  </button>
                  <button type="button" className="btn" onClick={()=>setModal(null)}>Cancel</button>
                </div>
              </>
            )}

            {(modal==='create'||modal==='edit')&&(
              <>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
