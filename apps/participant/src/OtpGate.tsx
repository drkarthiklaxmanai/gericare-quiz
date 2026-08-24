import {FormEvent,useEffect,useState} from 'react'
import type {Session} from '@supabase/supabase-js'
import App from './App'
import {supabase} from './lib/supabase'

export default function OtpGate(){
 const[session,setSession]=useState<Session|null>(null),[email,setEmail]=useState(''),[token,setToken]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 useEffect(()=>{if(!supabase)return;void supabase.auth.getSession().then(({data})=>setSession(data.session));const{data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe()},[])
 if(!supabase||session)return <App/>
 async function send(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');const{error}=await supabase!.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true}});setBusy(false);if(error){setMessage(error.message);return}setSent(true);setMessage('A 6-digit code has been sent to your email.')}
 async function verify(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');const{error}=await supabase!.auth.verifyOtp({email:email.trim(),token:token.trim(),type:'email'});setBusy(false);if(error){setMessage(error.message);return}setMessage('Signed in')}
 return <main className="shell"><header><div className="brand">GERiCARE <span>QUIZ</span></div><div className="badge">CONFERENCE</div></header><section className="card hero"><p className="eyebrow">PARTICIPANT SIGN IN</p><h1>{sent?'Enter your OTP':'Join the conference quiz'}</h1>{!sent?<form onSubmit={send}><input className="field" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><button disabled={busy||!email.includes('@')} type="submit">{busy?'Sending…':'Send OTP'}</button></form>:<form onSubmit={verify}><p>Code sent to <b>{email}</b></p><input className="field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,'').slice(0,6))}/><button disabled={busy||token.length!==6} type="submit">{busy?'Verifying…':'Verify & sign in'}</button><button className="secondary" type="button" onClick={()=>{setSent(false);setToken('');setMessage('')}}>Use another email</button></form>}{message&&<div className="notice">{message}</div>}</section></main>
}
