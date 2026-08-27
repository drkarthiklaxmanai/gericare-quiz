import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
type ManifestItem={question_id:string;position:number;option_order:string[]};
type ImageMedia={id:string;url:string;mime_type:string|null;alt:string};

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

  const signedImages=async(qids:string[])=>{
    const out=new Map<string,ImageMedia[]>();
    if(!qids.length)return out;
    const{data:rows,error}=await adminClient.from("question_media").select("id,question_id,storage_path,mime_type,metadata,sort_order").in("question_id",qids).eq("media_type","image").order("sort_order");
    if(error)throw error;
    for(const m of rows??[]){
      const{data:s,error:se}=await adminClient.storage.from("question-media").createSignedUrl(m.storage_path,3600);
      if(se||!s?.signedUrl)continue;
      const alt=String((m.metadata as any)?.alt??(m.metadata as any)?.original_name??"Question image");
      const list=out.get(m.question_id)??[];
      list.push({id:m.id,url:s.signedUrl,mime_type:m.mime_type??null,alt});
      out.set(m.question_id,list);
    }
    return out;
  };

  try{
    const body=await req.json();const action=body?.action;
    if(action==="available_rounds"){
      const{data:ep}=await adminClient.from("event_participants").select("id,event_id").eq("user_id",uid).eq("event_id",body.event_id).maybeSingle();if(!ep)return json({error:"not_registered"},403);
      const{data:rounds,error:re}=await adminClient.from("rounds").select("id,round_number,title,status,is_optional,opened_at,closed_at,results_released_at").eq("event_id",body.event_id).order("round_number");if(re)throw re;
      const{data:attempts,error:ae}=await adminClient.from("attempts").select("round_id,status,score,result_released_at,submitted_at").eq("event_id",body.event_id).eq("participant_id",ep.id);if(ae)throw ae;
      const now=Date.now();
      const enrichedRounds=(rounds??[]).map(r=>({...r,results_released:!!r.results_released_at&&new Date(r.results_released_at).getTime()<=now}));
      return json({rounds:enrichedRounds,attempts:attempts??[]});
    }
    if(action==="start_round"){
      const result=await userClient.rpc("start_quiz_attempt",{p_event:body.event_id,p_round:body.round_id});if(result.error)return json({error:result.error.message,code:result.error.code},400);
      const r=result.data as{attempt_id:string;started_at:string;deadline_at:string;question_manifest:ManifestItem[]};const manifest=r.question_manifest??[];
      const qids=manifest.map(x=>x.question_id);const{data:questions,error:qe}=await adminClient.from("questions").select("id,stem,type").in("id",qids);if(qe)throw qe;
      const optionIds=manifest.flatMap(x=>x.option_order??[]);const{data:options,error:oe}=await adminClient.from("question_options").select("id,question_id,option_key,option_text").in("id",optionIds);if(oe)throw oe;
      const media=await signedImages(qids);
      const hydrated=[...manifest].sort((a,b)=>a.position-b.position).map(m=>({id:m.question_id,stem:questions?.find(q=>q.id===m.question_id)?.stem??"",type:questions?.find(q=>q.id===m.question_id)?.type??"single_choice",media:media.get(m.question_id)??[],options:(m.option_order??[]).map((oid,i)=>{const o=options?.find(x=>x.id===oid);return{id:oid,label:String.fromCharCode(65+i),text:o?.option_text??"",option_key:o?.option_key??""}})}));
      return json({id:r.attempt_id,started_at:r.started_at,deadline_at:r.deadline_at,questions:hydrated});
    }
    if(action==="answer"){const result=await userClient.rpc("submit_quiz_response",{p_attempt:body.attempt_id,p_question:body.question_id,p_option:body.option_key,p_client_ms:body.client_ms??null});if(result.error)return json({error:result.error.message},400);return json(result.data??{accepted:true});}
    if(action==="finish_round"){const result=await userClient.rpc("finish_quiz_attempt",{p_attempt:body.attempt_id});if(result.error)return json({error:result.error.message},400);return json(result.data);}
    if(action==="integrity"){const result=await userClient.rpc("record_integrity_event",{p_attempt:body.attempt_id,p_event:body.event_type,p_metadata:body.metadata??{}});if(result.error)return json({error:result.error.message},400);return json(result.data);}
    if(action==="history"){
      const{data:ep}=await adminClient.from("event_participants").select("id").eq("event_id",body.event_id).eq("user_id",uid).maybeSingle();if(!ep)return json({error:"not_registered"},403);
      const now=Date.now();
      const{data:allRounds,error:re}=await adminClient.from("rounds").select("id,round_number,title,status,results_released_at").eq("event_id",body.event_id).order("round_number");if(re)throw re;
      const{data:myAttempts,error:ae}=await adminClient.from("attempts").select("id,round_id,status,score,valid_response_time_ms,submitted_at,result_released_at,created_at").eq("participant_id",ep.id).eq("event_id",body.event_id);if(ae)throw ae;
      const myByRound=new Map((myAttempts??[]).map(a=>[a.round_id,a]));
      const out:any[]=[];

      for(const round of allRounds??[]){
        const released=!!round.results_released_at&&new Date(round.results_released_at).getTime()<=now;
        const mine=myByRound.get(round.id);
        if(!released&&!mine)continue;
        if(!released&&mine){
          out.push({...mine,released:false,attempted:true,round:{round_number:round.round_number,title:round.title},responses:undefined});
          continue;
        }

        const{data:rq}=await adminClient.from("round_questions").select("question_id,canonical_order").eq("round_id",round.id).order("canonical_order");
        const qids=(rq??[]).map(x=>x.question_id);
        const{data:qs}=qids.length?await adminClient.from("questions").select("id,stem,explanation").in("id",qids):{data:[]};
        const{data:opts}=qids.length?await adminClient.from("question_options").select("question_id,option_key,option_text,is_correct").in("question_id",qids).order("option_key"):{data:[]};
        const media=await signedImages(qids);
        const responseMap=new Map<string,{selected_option_key:string|null;is_correct:boolean|null;points_awarded:number|null}>();
        if(mine){
          const{data:responses}=await adminClient.from("responses").select("question_id,selected_option_key,is_correct,points_awarded").eq("attempt_id",mine.id);
          for(const r of responses??[])responseMap.set(r.question_id,{selected_option_key:r.selected_option_key,is_correct:r.is_correct,points_awarded:r.points_awarded});
        }
        const review=(rq??[]).map(row=>{
          const q=qs?.find(x=>x.id===row.question_id);
          const qOpts=(opts??[]).filter(o=>o.question_id===row.question_id);
          const correct=qOpts.find(o=>o.is_correct);
          const resp=responseMap.get(row.question_id);
          const selected=resp?.selected_option_key?(qOpts.find(o=>o.option_key===resp.selected_option_key)?.option_text??resp.selected_option_key):null;
          return{question_id:row.question_id,stem:q?.stem??"",media:media.get(row.question_id)??[],selected_option:selected,selected_option_key:resp?.selected_option_key??null,correct_option:correct?.option_text??"",correct_option_key:correct?.option_key??"",is_correct:resp?.is_correct??null,points_awarded:resp?.points_awarded??null,explanation:q?.explanation??null,options:qOpts.map(o=>({key:o.option_key,text:o.option_text,correct:!!o.is_correct}))};
        });
        out.push({id:mine?.id??`review-${round.id}`,round_id:round.id,status:mine?.status??"skipped",score:mine?.score??null,submitted_at:mine?.submitted_at??null,result_released_at:round.results_released_at,released:true,attempted:!!mine,round:{round_number:round.round_number,title:round.title},responses:review});
      }
      out.sort((a,b)=>(a.round?.round_number??99)-(b.round?.round_number??99));
      return json({attempts:out});
    }
    if(action==="leaderboard"){const{data:ep}=await adminClient.from("event_participants").select("id").eq("event_id",body.event_id).eq("user_id",uid).maybeSingle();if(!ep)return json({error:"not_registered"},403);const{data,error}=await adminClient.from("leaderboard_snapshots").select("snapshot_type,payload,created_at").eq("event_id",body.event_id).in("snapshot_type",["overall_top10","final","winner"]).order("created_at",{ascending:false}).limit(1).maybeSingle();if(error)throw error;return json({snapshot:data});}
    return json({error:"unknown_action"},400);
  }catch(e){return json({error:e instanceof Error?e.message:"invalid_request"},400)}
});
