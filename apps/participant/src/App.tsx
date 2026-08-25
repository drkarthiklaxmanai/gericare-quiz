import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { quizApi } from './lib/quiz-api'
import { supabase } from './lib/supabase'
import FinalPanel from './FinalPanel'
import './styles.css'

type Screen='auth'|'otp'|'register'|'home'|'quiz'|'submitted'|'history'|'leaderboard'
type Question={id:string;stem:string;options:{id:string;label:string;text:string;option_key:string}[]}
type Attempt={id:string;deadline_at:string;questions:Question[]}
type Participant={id:string;event_id:string;display_name:string}
type EventInfo={id:string;name:string;status:string;registration_open:boolean}
type Round={id:string;round_number:number;title:string;status:string;is_optional:boolean}
type AttemptSummary={round_id:string;status:string;score:number;result_released_at:string|null;submitted_at:string|null}
type HistoryItem={id:string;status:string;score:number;result_released_at:string|null;released:boolean;round:{round_number:number;title:string}|null;responses?:{question_id:string;stem:string;selected_option:string|null;correct_option:string;is_correct:boolean;points_awarded:number;explanation:string|null}[]}

function errText(e:unknown):string{
  if(e==null)return 'Unknown error'
  if(typeof e==='string')return e
  if(e instanceof Error&&e.message)return e.message
  if(typeof e==='object'){
    const o=e as Record<string,unknown>
    const parts=[o.message,o.details,o.hint,o.code].filter(v=>typeof v==='string'&&String(v).trim()).map(String)
    if(parts.length)return parts.join(' — ')
  }
  try{return JSON.stringify(e)}catch{return String(e)}
}

function isReleased(a:AttemptSummary|undefined):boolean{
  if(!a?.result_released_at)return false
  return new Date(a.result_released_at).getTime()<=Date.now()
}

export default function App(){
 const[screen,setScreen]=useState<Screen>('auth'),[session,setSession]=useState<Session|null>(null),[event,setEvent]=useState<EventInfo|null>(null),[participant,setParticipant]=useState<Participant|null>(null)
 const[email,setEmail]=useState(''),[otp,setOtp]=useState(''),[displayName,setDisplayName]=useState(''),[attempt,setAttempt]=useState<Attempt|null>(null),[current,setCurrent]=useState(0),[answers,setAnswers]=useState<Record<string,string>>({}),[remaining,setRemaining]=useState(600),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const[rounds,setRounds]=useState<Round[]>([]),[roundAttempts,setRoundAttempts]=useState<AttemptSummary[]>([]),[history,setHistory]=useState<HistoryItem[]>([]),[leaderboard,setLeaderboard]=useState<any>(null)
 const questions=useMemo(()=>attempt?.questions??[],[attempt])
 useEffect(()=>{if(!supabase){setScreen('home');setMessage('Demo mode: Supabase is not configured.');return}void supabase.auth.getSession().then(({data})=>{setSession(data.session);if(data.session)void bootstrap()});const{data:l}=supabase.auth.onAuthStateChange((_e,next)=>{setSession(next);if(next)void bootstrap()});return()=>l.subscription.unsubscribe()},[])
 async function bootstrap(){if(!supabase)return;setBusy(true);try{const configured=import.meta.env.VITE_EVENT_ID as string|undefined;let query=supabase.from('events').select('id,name,status,registration_open');if(configured)query=query.eq('id',configured);const{data:ev,error:ee}=await query.limit(1).maybeSingle();if(ee)throw ee;if(!ev)throw Error('No accessible conference event');setEvent(ev);const{data:ep,error:pe}=await supabase.from('event_participants').select('id,event_id,display_name').eq('event_id',ev.id).maybeSingle();if(pe)throw pe;if(ep){setParticipant(ep);setScreen('home');await loadHome(ev.id)}else setScreen('register')}catch(e){setMessage(errText(e))}finally{setBusy(false)}}
 async function loadHome(eventId=event?.id){if(!eventId)return;const r=await quizApi.availableRounds(eventId);if(r.error){setMessage(errText(r.error));return}const d=r.data as any;setRounds(d?.rounds??[]);setRoundAttempts(d?.attempts??[])}
 // Soft-refresh home while visible so released results appear without manual reload
 useEffect(()=>{
   if(screen!=='home'||!event)return
   const id=window.setInterval(()=>{void loadHome(event.id)},20000)
   return()=>window.clearInterval(id)
 },[screen,event?.id])
 async function sendOtp(){if(!supabase)return;setBusy(true);setMessage('');try{const{error}=await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true}});if(error)throw error;setOtp('');setScreen('otp');setMessage('Enter the 6-digit code from your email.')}catch(e){setMessage(errText(e))}finally{setBusy(false)}}
 async function verifyOtp(){if(!supabase)return;setBusy(true);setMessage('');try{const{error}=await supabase.auth.verifyOtp({email:email.trim(),token:otp.trim(),type:'email'});if(error)throw error;setMessage('Verified. Loading…')}catch(e){setMessage(errText(e))}finally{setBusy(false)}}
 async function register(){if(!supabase||!event)return;setBusy(true);setMessage('');try{const{data,error}=await supabase.rpc('register_for_event',{p_event_id:event.id,p_display_name:displayName.trim()});if(error)throw error;const row=Array.isArray(data)?data[0]:data;setParticipant(row as Participant);setScreen('home');await loadHome(event.id)}catch(e){setMessage(errText(e))}finally{setBusy(false)}}
 useEffect(()=>{if(screen!=='quiz'||!attempt)return;const tick=()=>setRemaining(Math.max(0,Math.ceil((new Date(attempt.deadline_at).getTime()-Date.now())/1000)));tick();const t=window.setInterval(()=>{const left=Math.max(0,Math.ceil((new Date(attempt.deadline_at).getTime()-Date.now())/1000));setRemaining(left);if(left<=0){window.clearInterval(t);void finish()}},1000);return()=>window.clearInterval(t)},[screen,attempt])
 useEffect(()=>{const f=()=>{if(document.visibilityState==='hidden'&&attempt)void quizApi.integrity(attempt.id,'visibility_hidden')};document.addEventListener('visibilitychange',f);return()=>document.removeEventListener('visibilitychange',f)},[attempt])
 async function start(round:Round){if(!event)return;setBusy(true);setMessage('');const r=await quizApi.startRound(event.id,round.id);setBusy(false);if(r.error){setMessage(errText(r.error));return}const a=r.data as Attempt;setAttempt(a);setCurrent(0);setAnswers({});setRemaining(Math.max(0,Math.ceil((new Date(a.deadline_at).getTime()-Date.now())/1000)));setScreen('quiz')}
 async function choose(optionKey:string){const q=questions[current];setAnswers(v=>({...v,[q.id]:optionKey}));if(attempt){const r=await quizApi.answer(attempt.id,q.id,optionKey);if(r.error)setMessage(errText(r.error))}}
 async function finish(){if(attempt)await quizApi.finishRound(attempt.id);setScreen('submitted');if(event)await loadHome(event.id)}
 async function showHistory(){if(!event)return;setBusy(true);const r=await quizApi.history(event.id);setBusy(false);if(r.error){setMessage(errText(r.error));return}setHistory((r.data as any)?.attempts??[]);setScreen('history')}
 async function showLeaderboard(){if(!event)return;setBusy(true);const r=await quizApi.leaderboard(event.id);setBusy(false);if(r.error){setMessage(errText(r.error));return}setLeaderboard((r.data as any)?.snapshot??null);setScreen('leaderboard')}
 async function signOut(){if(supabase)await supabase.auth.signOut();setSession(null);setParticipant(null);setOtp('');setScreen('auth')}
 const q=questions[current],mins=Math.floor(remaining/60).toString().padStart(2,'0'),secs=(remaining%60).toString().padStart(2,'0')
 const attemptFor=(id:string)=>roundAttempts.find(a=>a.round_id===id)
 const boardRows=(()=>{
   const p=leaderboard?.payload??leaderboard?.rows??leaderboard?.leaderboard??leaderboard
   return Array.isArray(p)?p:[]
 })()
 const releasedCount=roundAttempts.filter(a=>isReleased(a)).length
 return <main className="shell"><header><div className="brand">GERiCARE <span>QUIZ</span></div><div className="badge">CONFERENCE</div></header>
 {screen==='auth'&&<section className="card hero"><p className="eyebrow">PARTICIPANT SIGN IN</p><h1>Join the conference quiz</h1><input className="field" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/>{message&&<div className="notice">{message}</div>}<button disabled={busy||!email.includes('@')} onClick={sendOtp}>{busy?'Sending…':'Email me a 6-digit code'}</button></section>}
 {screen==='otp'&&<section className="card hero"><p className="eyebrow">VERIFICATION</p><h1>Enter your code</h1><p>We sent a 6-digit code to <b>{email}</b>.</p><input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}/>{message&&<div className="notice">{message}</div>}<button disabled={busy||otp.length!==6} onClick={verifyOtp}>{busy?'Verifying…':'Verify and sign in'}</button><button className="secondary" disabled={busy} onClick={()=>{setScreen('auth');setOtp('');setMessage('')}}>Use a different email</button></section>}
 {screen==='register'&&<section className="card hero"><p className="eyebrow">REGISTRATION</p><h1>{event?.name??'GERiCARE Conference Quiz'}</h1><p>Choose the name that should appear on the leaderboard.</p><input className="field" placeholder="Display name" value={displayName} onChange={e=>setDisplayName(e.target.value)}/>{message&&<div className="notice">{message}</div>}<button disabled={busy||displayName.trim().length<2} onClick={register}>Complete Registration</button></section>}
 {screen==='home'&&<><section className="card hero"><p className="eyebrow">PARTICIPANT</p><h1>Welcome{participant?.display_name?`, ${participant.display_name}`:''}</h1><p>Your 10-minute timer starts independently when you press Start.</p>{message&&<div className="notice">{message}</div>}<div className="nav"><button onClick={showHistory}>My Quiz{releasedCount>0?` · ${releasedCount} result${releasedCount>1?'s':''}`:''}</button><button className="secondary" onClick={showLeaderboard}>Leaderboard</button></div></section>{event&&<FinalPanel eventId={event.id}/>}<section className="roundList">{rounds.map(r=>{
   const a=attemptFor(r.id)
   const canStart=r.status==='open'&&!a
   const released=isReleased(a)
   const pending=!!a&&!released
   let statusText=r.status==='open'?'Open now':r.status
   if(released)statusText=`Your score: ${a!.score} pts`
   else if(pending)statusText='Submitted · results pending'
   else if(a)statusText=`Status: ${a.status}`
   return <div className="card roundCard" key={r.id}><div><p className="eyebrow">ROUND {r.round_number}{r.is_optional?' · OPTIONAL':''}</p><h3>{r.title}</h3><p>{statusText}</p></div>{
     released
       ? <button onClick={showHistory}>View results</button>
       : <button disabled={!canStart||busy} onClick={()=>start(r)}>{pending?'Waiting for release':canStart?'Start':'Unavailable'}</button>
   }</div>
 })}</section>{session&&<button className="secondary standalone" onClick={signOut}>Sign out</button>}</>}
 {screen==='quiz'&&q&&<section className="card"><div className="quizTop"><span>Question {current+1} of {questions.length}</span><strong>{mins}:{secs}</strong></div><div className="progress"><i style={{width:`${((current+1)/questions.length)*100}%`}}/></div><p className="eyebrow">SINGLE BEST ANSWER</p><h2>{q.stem}</h2>{message&&<div className="notice">{message}</div>}<div className="options">{q.options.map(o=><button key={o.id} className={answers[q.id]===o.option_key?'option selected':'option'} onClick={()=>choose(o.option_key)}><b>{o.label}</b><span>{o.text}</span></button>)}</div><div className="actions">{current>0&&<button className="secondary" onClick={()=>setCurrent(v=>v-1)}>Previous</button>}{current<questions.length-1?<button disabled={!answers[q.id]} onClick={()=>setCurrent(v=>v+1)}>Next</button>:<button disabled={!answers[q.id]} onClick={finish}>Submit Round</button>}</div></section>}
 {screen==='submitted'&&<section className="card hero"><div className="check">✓</div><p className="eyebrow">SUBMITTED</p><h1>Round submitted</h1><p>Your score and the full Q&A with explanations will appear in <b>My Quiz</b> once the host releases results.</p><button onClick={()=>setScreen('home')}>Back to Home</button><button className="secondary" onClick={showHistory} style={{marginTop:8}}>Open My Quiz</button></section>}
 {screen==='history'&&<section><div className="screenHead"><div><p className="eyebrow">MY QUIZ</p><h2>Round history</h2></div><button className="secondary small" onClick={()=>setScreen('home')}>Back</button></div>{!history.length&&<div className="card"><p>No attempts yet. Start an open round from Home.</p></div>}{history.map(h=><div className="card historyCard" key={h.id}><div className="historyTop"><div><b>Round {h.round?.round_number}</b><span>{h.round?.title}</span></div><strong>{h.released?`${h.score} pts`:'Pending release'}</strong></div>{h.released&&h.responses?.map((r,i)=><div className="answerReview" key={r.question_id}><b>{i+1}. {r.stem}</b><p className={r.is_correct?'correct':'wrong'}>{r.is_correct?'✓ Correct':'✕ Incorrect'} · Your answer: {r.selected_option??'No answer'}{r.points_awarded!=null?` · ${r.points_awarded} pts`:''}</p>{!r.is_correct&&<p>Correct answer: {r.correct_option}</p>}{r.explanation&&<small>{r.explanation}</small>}</div>)}{h.released&&!h.responses?.length&&<p className="muted">Results released — detail unavailable.</p>}</div>)}</section>}
 {screen==='leaderboard'&&<section><div className="screenHead"><div><p className="eyebrow">STANDINGS</p><h2>Leaderboard</h2></div><button className="secondary small" onClick={()=>setScreen('home')}>Back</button></div><div className="card">{boardRows.length?boardRows.map((x:any,i:number)=><div className="leaderRow" key={x.participant_id??i}><b>#{x.rank??i+1}</b><span>{x.display_name??x.name??'Participant'}</span><strong>{x.score??x.best5_score??0}</strong></div>):<p>No released leaderboard yet.</p>}</div></section>}
 </main>
}
