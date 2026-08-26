import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "@supabase/supabase-js";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"content-type"};
const fail=(status:number,msg:string)=>new Response(msg,{status,headers:{...cors,"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="GET")return fail(405,"method_not_allowed");
 const base=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!service)return fail(500,"server_not_configured");
 const u=new URL(req.url);const eventId=u.searchParams.get("event_id"),path=u.searchParams.get("path");
 if(!eventId||!path)return fail(400,"missing_parameters");
 const sb=createClient(base,service,{auth:{persistSession:false}});
 const{data:state,error}=await sb.from("presentation_state").select("state,media").eq("event_id",eventId).maybeSingle();
 if(error||!state)return fail(404,"presentation_not_found");
 if(!["QUESTION","ANSWER_REVEAL","EXPLANATION"].includes(state.state))return fail(403,"media_not_currently_presented");
 const media=Array.isArray(state.media)?state.media:[];
 const allowed=media.some((m:any)=>m&&m.storage_path===path);
 if(!allowed)return fail(403,"media_not_currently_presented");
 const{data:file,error:fe}=await sb.storage.from("question-media").download(path);
 if(fe||!file)return fail(404,"media_not_found");
 const match=media.find((m:any)=>m?.storage_path===path);
 const type=match?.mime_type||file.type||"image/jpeg";
 return new Response(file,{status:200,headers:{...cors,"content-type":type,"cache-control":"private, max-age=30"}});
});
