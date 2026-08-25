import {createClient} from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const configuredEvent=import.meta.env.VITE_EVENT_ID as string|undefined;
const root=document.getElementById('root')!;

function shell(title:string,body:string){
 root.innerHTML=`<div style="min-height:100vh;display:grid;place-items:center;background:#f5f7fa;font-family:Inter,system-ui,sans-serif;color:#172033;padding:20px"><div style="width:min(420px,100%);background:#fff;border:1px solid #e4e8ef;border-radius:18px;padding:26px;box-shadow:0 12px 32px rgba(15,23,42,.08)"><div style="font-size:11px;font-weight:800;letter-spacing:.12em;color:#6b7280">GERiCARE • SECURE ACCESS</div><h1 style="font-size:26px;margin:8px 0 18px">${title}</h1>${body}</div></div>`;
}
function renderLogin(message='Sign in with your authorized administrator email.'){
 shell('Control Room',`<p style="color:#64748b;line-height:1.5">${message}</p><form id="login-form" style="display:grid;gap:12px"><input id="email" type="email" required autocomplete="email" placeholder="Email address" style="font:inherit;padding:12px;border:1px solid #d8dee8;border-radius:10px"/><button style="font:inherit;font-weight:800;padding:12px;border:0;border-radius:10px;background:#172033;color:#fff">Send verification code</button></form><p id="login-status" style="font-size:13px;color:#64748b"></p>`);
 const form=document.getElementById('login-form') as HTMLFormElement;
 form.onsubmit=async e=>{e.preventDefault();const email=(document.getElementById('email') as HTMLInputElement).value.trim();const status=document.getElementById('login-status')!;status.textContent='Sending code…';const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error){status.textContent=error.message;return}renderOtp(email)};
}
function renderOtp(email:string,message=`We sent a 6-digit verification code to ${email}.`){
 shell('Enter verification code',`<p style="color:#64748b;line-height:1.5">${message}</p><form id="otp-form" style="display:grid;gap:12px"><input id="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="6-digit code" style="font:inherit;font-size:24px;letter-spacing:.18em;text-align:center;padding:12px;border:1px solid #d8dee8;border-radius:10px"/><button style="font:inherit;font-weight:800;padding:12px;border:0;border-radius:10px;background:#172033;color:#fff">Verify and sign in</button></form><button id="back" style="margin-top:12px;border:0;background:transparent;color:#64748b;font:inherit;padding:6px 0">Use a different email</button><p id="otp-status" style="font-size:13px;color:#64748b"></p>`);
 const form=document.getElementById('otp-form') as HTMLFormElement;
 form.onsubmit=async e=>{e.preventDefault();const token=(document.getElementById('otp') as HTMLInputElement).value.trim();const status=document.getElementById('otp-status')!;status.textContent='Verifying…';const {error}=await supabase.auth.verifyOtp({email,token,type:'email'});status.textContent=error?error.message:'Verified. Signing in…';if(!error)void authorize()};
 document.getElementById('back')!.onclick=()=>renderLogin();
}
function addSignOut(){const b=document.createElement('button');b.textContent='Sign out';b.style.cssText='position:fixed;right:14px;bottom:14px;z-index:9999;border:1px solid #d8dee8;background:white;border-radius:10px;padding:9px 12px;font-weight:700;box-shadow:0 4px 18px rgba(15,23,42,.12)';b.onclick=async()=>{await supabase.auth.signOut();location.reload()};document.body.appendChild(b)}

if(!url||!key){shell('Control Room','<p>Supabase environment is not configured.</p>');throw new Error('Supabase environment not configured')}
const supabase=createClient(url,key);

async function authorize(){
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user){renderLogin();return}
 let q=supabase.from('event_admins').select('event_id,role').eq('user_id',user.id).eq('role','super_admin');
 if(configuredEvent)q=q.eq('event_id',configuredEvent);
 const {data:access,error:accessError}=await q.limit(1).maybeSingle();
 if(accessError){shell('Control Room',`<p>Authorization check failed: ${accessError.message}</p>`);return}
 if(!access){shell('Access denied','<p>This account is signed in but does not have Control Room privileges.</p><button id="logout" style="padding:10px 14px;border:0;border-radius:9px;background:#172033;color:#fff;font-weight:700">Sign out</button>');document.getElementById('logout')!.onclick=async()=>{await supabase.auth.signOut();location.reload()};return}
 root.innerHTML='';
 await import('./main.tsx');
 addSignOut();
}

supabase.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN')void authorize()});
void authorize();
