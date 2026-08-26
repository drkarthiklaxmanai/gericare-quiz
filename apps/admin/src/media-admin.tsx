import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const sb=url&&key?createClient(url,key):null;

type Q={id:string;stem:string;status:string;difficulty:number};
type M={id:string;question_id:string;media_type:string;storage_path:string;mime_type:string|null;metadata:any;sort_order:number};
type Preview=M&{url?:string};

function errText(e:unknown){if(e instanceof Error)return e.message;if(typeof e==='string')return e;try{return JSON.stringify(e)}catch{return String(e)}}

function App(){
 const[eventId,setEventId]=useState(configuredEvent??'');
 const[questions,setQuestions]=useState<Q[]>([]);
 const[media,setMedia]=useState<Record<string,Preview[]>>({});
 const[search,setSearch]=useState('');
 const[busy,setBusy]=useState<string|null>(null);
 const[message,setMessage]=useState('Images are private until served to an active participant or projector review.');

 const resolveEvent=async()=>{
  if(eventId)return eventId;
  if(!sb)throw Error('Supabase not configured');
  const{data,error}=await sb.from('events').select('id').limit(1).maybeSingle();
  if(error)throw error;if(!data)throw Error('No accessible event');setEventId(data.id);return data.id;
 };

 const load=async()=>{
  if(!sb)return;
  try{
   const eid=await resolveEvent();
   const[{data:q,error:qe},{data:m,error:me}]=await Promise.all([
    sb.from('questions').select('id,stem,status,difficulty').eq('event_id',eid).order('created_at',{ascending:false}),
    sb.from('question_media').select('id,question_id,media_type,storage_path,mime_type,metadata,sort_order').eq('media_type','image').order('sort_order'),
   ]);
   if(qe||me)throw(qe||me);
   const rows=(m??[]) as M[];
   const paths=rows.map(x=>x.storage_path);
   const signed=new Map<string,string>();
   if(paths.length){
    const{data}=await sb.storage.from('question-media').createSignedUrls(paths,3600);
    for(const x of data??[])if(x.path&&x.signedUrl)signed.set(x.path,x.signedUrl);
   }
   const by:Record<string,Preview[]>={};
   for(const x of rows){(by[x.question_id]??=[]).push({...x,url:signed.get(x.storage_path)})}
   setQuestions(q??[]);setMedia(by);
  }catch(e){setMessage(errText(e))}
 };
 useEffect(()=>{void load()},[]);

 const filtered=useMemo(()=>questions.filter(q=>!search.trim()||q.stem.toLowerCase().includes(search.toLowerCase())),[questions,search]);

 const upload=async(q:Q,file:File)=>{
  if(!sb)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setMessage('Use JPEG, PNG or WebP images.');return}
  if(file.size>10*1024*1024){setMessage('Image must be 10 MB or smaller.');return}
  setBusy(q.id);setMessage('Uploading image…');
  try{
   const eid=await resolveEvent();
   const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
   const path=`${eid}/${q.id}/${crypto.randomUUID()}.${ext}`;
   const{error:ue}=await sb.storage.from('question-media').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
   if(ue)throw ue;
   const{error:ie}=await sb.from('question_media').insert({question_id:q.id,media_type:'image',storage_path:path,mime_type:file.type,metadata:{original_name:file.name,size:file.size},sort_order:(media[q.id]?.length??0)});
   if(ie){await sb.storage.from('question-media').remove([path]);throw ie}
   setMessage('Image attached.');await load();
  }catch(e){setMessage(errText(e))}finally{setBusy(null)}
 };

 const remove=async(m:Preview)=>{
  if(!sb||!confirm('Remove this image from the question?'))return;
  setBusy(m.question_id);setMessage('Removing image…');
  try{
   const{error:de}=await sb.from('question_media').delete().eq('id',m.id);if(de)throw de;
   const{error:se}=await sb.storage.from('question-media').remove([m.storage_path]);if(se)throw se;
   setMessage('Image removed.');await load();
  }catch(e){setMessage(errText(e))}finally{setBusy(null)}
 };

 return <div className="app">
  <header className="topbar"><div><small>GERiCARE</small><h1>Question images</h1></div><div className="pill">{message}</div></header>
  <div className="wrap"><div className="card">
   <input className="search" placeholder="Search questions…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <p className="hint">Attach clinical photographs, radiographs, ECGs, pathology images or other still images. JPEG, PNG and WebP; maximum 10 MB each.</p>
   <div className="section">
    {filtered.map(q=><div className="qrow" key={q.id}>
     <div className="qrow-h" style={{cursor:'default'}}><span className={'badge '+(q.status==='approved'?'ok':'warn')}>{q.status}</span><span className="badge">D{q.difficulty}</span><strong style={{display:'block',marginTop:6,fontSize:13,lineHeight:1.35}}>{q.stem}</strong></div>
     <div className="qrow-b">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
       {(media[q.id]??[]).map(m=><div key={m.id} style={{border:'1px solid #eadde6',borderRadius:12,padding:8}}>{m.url?<img src={m.url} alt="Question image" style={{width:'100%',height:140,objectFit:'contain',borderRadius:8,background:'#faf7f9'}}/>:<div className="empty">Preview unavailable</div>}<button className="btn danger" style={{marginTop:8,width:'100%'}} disabled={busy===q.id} onClick={()=>void remove(m)}>Remove</button></div>)}
      </div>
      <label className="btn primary file-btn" style={{marginTop:10,display:'inline-block'}}>+ Attach image<input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy===q.id} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(q,f);e.currentTarget.value=''}}/></label>
     </div>
    </div>)}
    {!filtered.length&&<div className="empty">No matching questions.</div>}
   </div>
  </div></div>
 </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
