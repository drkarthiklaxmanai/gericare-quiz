import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { quizApi } from './lib/quiz-api'
import { supabase } from './lib/supabase'
import './styles.css'

type Screen = 'auth' | 'register' | 'home' | 'quiz' | 'submitted'
type Question = { id: string; stem: string; options: { id: string; label: string; text: string }[] }
type Attempt = { id: string; deadline_at: string; questions: Question[] }
type Participant = { id: string; event_id: string; display_name: string }
type EventInfo = { id: string; name: string; status: string; registration_open: boolean }

const demoQuestions: Question[] = [
  { id: 'demo-1', stem: 'Which finding is most characteristic of psoriasis?', options: [{id:'a',label:'A',text:'Auspitz sign'},{id:'b',label:'B',text:'Nikolsky sign'},{id:'c',label:'C',text:'Darier sign'},{id:'d',label:'D',text:'Koebner phenomenon'}] },
  { id: 'demo-2', stem: 'Which cell is the principal antigen-presenting cell in the epidermis?', options: [{id:'a',label:'A',text:'Langerhans cell'},{id:'b',label:'B',text:'Merkel cell'},{id:'c',label:'C',text:'Melanocyte'},{id:'d',label:'D',text:'Keratinocyte'}] },
  { id: 'demo-3', stem: 'Which layer contains the granular layer of the epidermis?', options: [{id:'a',label:'A',text:'Stratum basale'},{id:'b',label:'B',text:'Stratum spinosum'},{id:'c',label:'C',text:'Stratum granulosum'},{id:'d',label:'D',text:'Stratum corneum'}] },
]

export default function App() {
  const [screen, setScreen] = useState<Screen>('auth')
  const [session, setSession] = useState<Session | null>(null)
  const [event, setEvent] = useState<EventInfo | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<string,string>>({})
  const [remaining, setRemaining] = useState(600)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const questions = useMemo(() => attempt?.questions ?? demoQuestions, [attempt])

  useEffect(() => {
    if (!supabase) { setScreen('home'); setMessage('Demo mode: Supabase is not configured.'); return }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (data.session) void bootstrap() })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); if (next) void bootstrap() })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function bootstrap() {
    if (!supabase) return
    setBusy(true)
    try {
      const configured = import.meta.env.VITE_EVENT_ID as string | undefined
      let query = supabase.from('events').select('id,name,status,registration_open')
      if (configured) query = query.eq('id', configured)
      const { data: ev, error: ee } = await query.limit(1).maybeSingle()
      if (ee) throw ee
      if (!ev) throw new Error('No accessible conference event')
      setEvent(ev)
      const { data: ep, error: pe } = await supabase.from('event_participants').select('id,event_id,display_name').eq('event_id', ev.id).maybeSingle()
      if (pe) throw pe
      if (ep) { setParticipant(ep); setScreen('home') } else setScreen('register')
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function sendOtp() {
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
      if (error) throw error
      setOtpSent(true); setMessage('Verification code sent to your email.')
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function verifyOtp() {
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: 'email' })
      if (error) throw error
      setSession(data.session); await bootstrap()
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function register() {
    if (!supabase || !event) return
    setBusy(true); setMessage('')
    try {
      const { data, error } = await supabase.rpc('register_for_event', { p_event_id: event.id, p_display_name: displayName.trim() })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      setParticipant(row as Participant); setScreen('home')
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (screen !== 'quiz') return
    const timer = window.setInterval(() => {
      setRemaining(v => {
        if (v <= 1) { window.clearInterval(timer); void finish(); return 0 }
        return v - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [screen])

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden' && attempt) void quizApi.integrity(attempt.id, 'visibility_hidden') }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [attempt])

  async function start() {
    setMessage('')
    const result = await quizApi.startRound('current')
    if (result.data) setAttempt(result.data as Attempt)
    else setMessage(result.error?.message ?? 'No round is currently open.')
    setCurrent(0); setAnswers({}); setRemaining(600); setScreen('quiz')
  }

  async function choose(optionId: string) {
    const q = questions[current]
    setAnswers(v => ({ ...v, [q.id]: optionId }))
    if (attempt) await quizApi.answer(attempt.id, q.id, optionId)
  }

  async function finish() {
    if (attempt) await quizApi.finishRound(attempt.id)
    setScreen('submitted')
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setSession(null); setParticipant(null); setScreen('auth') }

  const q = questions[current]
  const mins = Math.floor(remaining / 60).toString().padStart(2, '0')
  const secs = (remaining % 60).toString().padStart(2, '0')

  return <main className="shell">
    <header><div className="brand">GERiCARE <span>QUIZ</span></div><div className="badge">CONFERENCE</div></header>
    {screen === 'auth' && <section className="card hero"><p className="eyebrow">PARTICIPANT SIGN IN</p><h1>Join the conference quiz</h1><p>Use your email to receive a one-time verification code.</p><input className="field" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} />{otpSent&&<input className="field" inputMode="numeric" placeholder="6-digit code" value={otp} onChange={e=>setOtp(e.target.value)} />}{message&&<div className="notice">{message}</div>}{otpSent?<button disabled={busy||otp.length<6} onClick={verifyOtp}>Verify & Continue</button>:<button disabled={busy||!email.includes('@')} onClick={sendOtp}>Send Code</button>}</section>}
    {screen === 'register' && <section className="card hero"><p className="eyebrow">REGISTRATION</p><h1>{event?.name ?? 'GERiCARE Conference Quiz'}</h1><p>Choose the name that should appear on the leaderboard.</p><input className="field" placeholder="Display name" value={displayName} onChange={e=>setDisplayName(e.target.value)} />{message&&<div className="notice">{message}</div>}<button disabled={busy||displayName.trim().length<2} onClick={register}>Complete Registration</button></section>}
    {screen === 'home' && <section className="card hero"><p className="eyebrow">PARTICIPANT</p><h1>Welcome{participant?.display_name ? `, ${participant.display_name}` : ''}</h1><p>Your timer starts only when you press Start. Each preliminary round contains three questions.</p>{message&&<div className="notice">{message}</div>}<button onClick={start}>Start Available Round</button>{session&&<button className="secondary standalone" onClick={signOut}>Sign out</button>}</section>}
    {screen === 'quiz' && <section className="card"><div className="quizTop"><span>Question {current + 1} of {questions.length}</span><strong>{mins}:{secs}</strong></div><div className="progress"><i style={{width:`${((current+1)/questions.length)*100}%`}} /></div><p className="eyebrow">SINGLE BEST ANSWER</p><h2>{q.stem}</h2><div className="options">{q.options.map(o => <button key={o.id} className={answers[q.id] === o.id ? 'option selected' : 'option'} onClick={() => choose(o.id)}><b>{o.label}</b><span>{o.text}</span></button>)}</div><div className="actions">{current > 0 && <button className="secondary" onClick={() => setCurrent(v=>v-1)}>Previous</button>}{current < questions.length-1 ? <button disabled={!answers[q.id]} onClick={() => setCurrent(v=>v+1)}>Next</button> : <button disabled={!answers[q.id]} onClick={finish}>Submit Round</button>}</div></section>}
    {screen === 'submitted' && <section className="card hero"><div className="check">✓</div><p className="eyebrow">SUBMITTED</p><h1>Round submitted</h1><p>Your result will become available after the conference release window opens.</p><button onClick={()=>setScreen('home')}>Back to Home</button></section>}
  </main>
}
