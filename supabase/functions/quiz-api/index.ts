import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
type ManifestItem={question_id:string;position:number;option_order:string[]};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const auth=req.headers.get("authorization");if(!auth)return json({error:"missing_authorization"},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return json({error:"server_not_configured"},500);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const adminClient=createClient(url,service,{auth:{persistSession:false}});
  const{data:ud,error:ue}=await userClient.auth.getUser();if(ue||!ud.user)return json({error:"unauthorized"},401);
  const uid=ud.user.id;
  try{
    const body=await req.json();const action=body?.action;
    if(action==="available_rounds"){
      const{data:ep}=await adminClient.from("event_participants").select("id,event_id").eq("user_id",uid).eq("event_id",body.event_id).maybeSingle();if(!ep)return json({error:"not_registered"},403);
      const{data:rounds,error:re}=await adminClient.from("rounds").select("id,round_number,title,status,is_optional,opened_at,closed_at").eq("event_id",body.event_id).order("round_number");if(re)throw re;
      const{data:attempts,error:ae}=await adminClient.from("attempts").select("round_id,status,score,result_released_at,submitted_at").eq("event_id",body.event_id).eq("participant_id",ep.id);if(ae)throw ae;
      return json({rounds:rounds??[],attempts:attempts??[]});
    }
    if(action==="start_round"){
      const result=await userClient.rpc("start_quiz_attempt",{p_event:body.event_id,p_round:body.round_id});if(result.error)return json({error:result.error.message,code:result.error.code},400);
      const r=result.data as{attempt_id:string;started_at:string;deadline_at:string;question_manifest:ManifestItem[]};const manifest=r.question_manifest??[];
      const qids=manifest.map(x=>x.question_id);const{data:questions,error:qe}=await adminClient.from("questions").select("id,stem,type").in("id",qids);if(qe)throw qe;
      const optionIds=manifest.flatMap(x=>x.option_order??[]);const{data:options,error:oe}=await adminClient.from("question_options").select("id,question_id,option_key,option_text").in("id",optionIds);if(oe)throw oe;
      const hydrated=[...manifest].sort((a,b)=>a.position-b.position).map(m=>({id:m.question_id,stem:questions?.find(q=>q.id===m.question_id)?.stem??"",type:questions?.find(q=>q.id===m.question_id)?.type??"single_choice",options:(m.option_order??[]).map((oid,i)=>{const o=options?.find(x=>x.id===oid);return{id:oid,label:String.fromCharCode(65+i),text:o?.option_text??"",option_key:o?.option_key??""}})}));
      return json({id:r.attempt_id,started_at:r.started_at,deadline_at:r.deadline_at,questions:hydrated});
    }
    if(action==="answer"){const result=await userClient.rpc("submit_quiz_response",{p_attempt:body.attempt_id,p_question:body.question_id,p_option:body.option_key,p_client_ms:body.client_ms??null});if(result.error)return json({error:result.error.message},400);return json({accepted:true});}
    if(action==="finish_round"){const result=await userClient.rpc("finish_quiz_attempt",{p_attempt:body.attempt_id});if(result.error)return json({error:result.error.message},400);return json(result.data);}
    if(action==="integrity"){const result=await userClient.rpc("record_integrity_event",{p_attempt:body.attempt_id,p_event:body.event_type,p_metadata:body.metadata??{}});if(result.error)return json({error:result.error.message},400);return json(result.data);}
    if(action==="history"){
      const{data:ep}=await adminClient.from("event_participants").select("id").eq("event_id",body.event_id).eq("user_id",uid).maybeSingle();if(!ep)return json({error:"not_registered"},403);
      const{data:attempts,error:ae}=await adminClient.from("attempts").select("id,round_id,status,score,valid_response_time_ms,submitted_at,result_released_at,created_at").eq("participant_id",ep.id).order("created_at",{ascending:false});if(ae)throw ae;
      const roundIds=[...new Set((attempts??[]).map(a=>a.round_id))];const{data:rounds}=roundIds.length?await adminClient.from("rounds").select("id,round_number,title").in("id",roundIds):{data:[]};const now=Date.now();const out:any[]=[];
      for(const a of attempts??[]){const released=!!a.result_released_at&&new Date(a.result_released_at).getTime()<=now;const base={...a,released,round:rounds?.find(r=>r.id===a.round_id)??null};if(!released){out.push(base);continue;}const{data:responses}=await adminClient.from("responses").select("question_id,selected_option_key,is_correct,points_awarded,response_time_ms,displayed_position").eq("attempt_id",a.id).order("displayed_position");const ids=(responses??[]).map(r=>r.question_id);const{data:qs}=ids.length?await adminClient.from("questions").select("id,stem,explanation").in("id",ids):{data:[]};const{data:opts}=ids.length?await adminClient.from("question_options").select("question_id,option_key,option_text,is_correct").in("question_id",ids):{data:[]};out.push({...base,responses:(responses??[]).map(r=>({question_id:r.question_id,stem:qs?.find(q=>q.id===r.question_id)?.stem??"",selected_option_key:r.selected_option_key,is_correct:r.is_correct,points_awarded:r.points_awarded,response_time_ms:r.response_time_ms,correct_option:opts?.find(o=>o.question_id===r.question_id&&o.is_correct)?.option_text??"",selected_option:opts?.find(o=>o.question_id===r.question_id&&o.option_key===r.selected_option_key)?.option_text??null,explanation:qs?.find(q=>q.id===r.question_id)?.explanation??null}))});}
      return json({attempts:out});
    }
    if(action==="leaderboard"){const{data:ep}=await adminClient.from("event_participants").select("id").eq("event_id",body.event_id).eq("user_id",uid).maybeSingle();if(!ep)return json({error:"not_registered"},403);const{data,error}=await adminClient.from("leaderboard_snapshots").select("snapshot_type,payload,created_at").eq("event_id",body.event_id).in("snapshot_type",["overall_top10","final","winner"]).order("created_at",{ascending:false}).limit(1).maybeSingle();if(error)throw error;return json({snapshot:data});}
    return json({error:"unknown_action"},400);
  }catch(e){return json({error:e instanceof Error?e.message:"invalid_request"},400)}
});
