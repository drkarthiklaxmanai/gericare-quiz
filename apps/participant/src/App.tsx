import { useEffect, useMemo, useState } from 'react'
import { quizApi } from './lib/quiz-api'
import './styles.css'

type Screen = 'home' | 'quiz' | 'submitted'
type Question = { id: string; stem: string; options: { id: string; label: string; text: string }[] }
type Attempt = { id: string; deadline_at: string; questions: Question[] }

const demoQuestions: Question[] = [
  { id: 'demo-1', stem: 'Which finding is most characteristic of psoriasis?', options: [{id:'a',label:'A',text:'Auspitz sign'},{id:'b',label:'B',text:'Nikolsky sign'},{id:'c',label:'C',text:'Darier sign'},{id:'d',label:'D',text:'Koebner phenomenon'}] },
  { id: 'demo-2', stem: 'Which cell is the principal antigen-presenting cell in the epidermis?', options: [{id:'a',label:'A',text:'Langerhans cell'},{id:'b',label:'B',text:'Merkel cell'},{id:'c',label:'C',text:'Melanocyte'},{id:'d',label:'D',text:'Keratinocyte'}] },
  { id: 'demo-3', stem: 'Which layer contains the granular layer of the epidermis?', options: [{id:'a',label:'A',text:'Stratum basale'},{id:'b',label:'B',text:'Stratum spinosum'},{id:'c',label:'C',text:'Stratum granulosum'},{id:'d',label:'D',text:'Stratum corneum'}] },
]

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<string,string>>({})
  const [remaining, setRemaining] = useState(600)
  const [message, setMessage] = useState('')

  const questions = useMemo(() => attempt?.questions ?? demoQuestions, [attempt])

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
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && attempt) void quizApi.integrity(attempt.id, 'visibility_hidden')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [attempt])

  async function start() {
    setMessage('')
    const result = await quizApi.startRound('current')
    if (result.data) setAttempt(result.data as Attempt)
    else setMessage(result.error?.message ?? 'Demo mode: backend round is not configured yet.')
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

  const q = questions[current]
  const mins = Math.floor(remaining / 60).toString().padStart(2, '0')
  const secs = (remaining % 60).toString().padStart(2, '0')

  return <main className="shell">
    <header><div className="brand">GERiCARE <span>QUIZ</span></div><div className="badge">CONFERENCE</div></header>
    {screen === 'home' && <section className="card hero"><p className="eyebrow">PARTICIPANT</p><h1>Ready for the quiz?</h1><p>Three questions. One attempt. Your timer starts when you press Start.</p>{message && <div className="notice">{message}</div>}<button onClick={start}>Start Round</button></section>}
    {screen === 'quiz' && <section className="card"><div className="quizTop"><span>Question {current + 1} of {questions.length}</span><strong>{mins}:{secs}</strong></div><div className="progress"><i style={{width:`${((current+1)/questions.length)*100}%`}} /></div><p className="eyebrow">SINGLE BEST ANSWER</p><h2>{q.stem}</h2><div className="options">{q.options.map(o => <button key={o.id} className={answers[q.id] === o.id ? 'option selected' : 'option'} onClick={() => choose(o.id)}><b>{o.label}</b><span>{o.text}</span></button>)}</div><div className="actions">{current > 0 && <button className="secondary" onClick={() => setCurrent(v=>v-1)}>Previous</button>}{current < questions.length-1 ? <button disabled={!answers[q.id]} onClick={() => setCurrent(v=>v+1)}>Next</button> : <button disabled={!answers[q.id]} onClick={finish}>Submit Round</button>}</div></section>}
    {screen === 'submitted' && <section className="card hero"><div className="check">✓</div><p className="eyebrow">SUBMITTED</p><h1>Round submitted</h1><p>Your result will be available when the conference release window opens.</p></section>}
  </main>
}
