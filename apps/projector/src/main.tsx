import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import './styles.css';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const supabase=url&&key?createClient(url,key):null;

type BoardRow={rank:number;name:string;score:number};
type DisplayState={
  state:string;
  round_number?:number;
  title?:string;
  question?:string;
  options?:string[]|unknown;
  answer?:string;
  explanation?:string;
  top10?:unknown;
};

const demo:DisplayState={state:'WAITING',title:'GERiCARE Conference Quiz'};

function asArray(value:unknown):unknown[]{
  if(Array.isArray(value))return value;
  if(value&&typeof value==='object'){
    const o=value as Record<string,unknown>;
    if(Array.isArray(o.rows))return o.rows;
    if(Array.isArray(o.leaderboard))return o.leaderboard;
    if(Array.isArray(o.top10))return o.top10;
  }
  return [];
}

function normalizeBoard(value:unknown):BoardRow[]{
  return asArray(value).map((row,i)=>{
    const r=(row&&typeof row==='object'?row:{}) as Record<string,unknown>;
    return{
      rank:Number(r.rank??i+1)||i+1,
      name:String(r.display_name??r.name??'Participant').trim()||'Participant',
      score:Number(r.score??r.total_score??0)||0,
    };
  });
}

function normalizeOptions(value:unknown):{key:string;text:string;correct?:boolean}[]{
  if(!Array.isArray(value))return [];
  return value.map((x,i)=>{
    if(typeof x==='string')return{key:String.fromCharCode(65+i),text:x};
    const o=(x&&typeof x==='object'?x:{}) as Record<string,unknown>;
    return{
      key:String(o.key??o.option_key??String.fromCharCode(65+i)),
      text:String(o.text??o.option_text??o.label??''),
      correct:!!(o.correct??o.is_correct),
    };
  });
}

function App(){
  const [view,setView]=useState<DisplayState>(demo);
  const [connected,setConnected]=useState(false);

  useEffect(()=>{
    if(!supabase)return;
    const load=async()=>{
      const {data}=await supabase.from('presentation_state').select('*').order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if(data)setView(data as DisplayState);
    };
    void load();
    const ch=supabase.channel('projector-display')
      .on('postgres_changes',{event:'*',schema:'public',table:'presentation_state'},p=>{if(p.new)setView(p.new as DisplayState)})
      .subscribe(s=>setConnected(s==='SUBSCRIBED'));
    return()=>{supabase.removeChannel(ch)};
  },[]);

  const board=normalizeBoard(view.top10);
  const options=normalizeOptions(view.options);

  const content=()=>{
    switch(view.state){
      case'RULES':
        return <><small>RULES</small><h1>How to Play</h1><p>Answer on your device before the timer ends.</p></>;
      case'QUESTION':
        // Also used as “round live” cue when options empty
        return <>
          <small>{view.title??(view.round_number?`ROUND ${view.round_number}`:'QUESTION')}</small>
          <h2 style={{whiteSpace:'pre-line'}}>{view.question}</h2>
          {options.length>0&&(
            <div className="options">
              {options.map((o,i)=>(
                <div key={i}><b>{o.key}</b>{o.text}</div>
              ))}
            </div>
          )}
        </>;
      case'ANSWER_REVEAL':
        return <>
          <small>{view.title??'REVIEW'}{view.round_number?` · ROUND ${view.round_number}`:''}</small>
          <h2>{view.question}</h2>
          <div className="options">
            {options.map((o,i)=>(
              <div key={i} className={o.correct||(view.answer&&(view.answer.startsWith(o.key)||view.answer===o.key))?'correct':''}>
                <b>{o.key}</b>{o.text}
              </div>
            ))}
          </div>
          {view.answer&&<p className="answer-line">Correct: <strong>{view.answer}</strong></p>}
          {view.explanation&&<p className="expl">{view.explanation}</p>}
        </>;
      case'EXPLANATION':
        return <><small>EXPLANATION</small><h2>{view.explanation}</h2></>;
      case'ROUND_TOP10':
      case'LEADERBOARD':
        return <>
          <small>{view.state==='ROUND_TOP10'?'ROUND TOP 10':'LEADERBOARD'}</small>
          <h1>{view.title??'Leaderboard'}</h1>
          <div className="board">
            {board.length?board.map(x=>(
              <div key={`${x.rank}-${x.name}`}><b>#{x.rank}</b><span>{x.name}</span><strong>{x.score}</strong></div>
            )):<div className="empty">No standings yet</div>}
          </div>
        </>;
      case'FINAL':
        return <><small>GRAND FINAL</small><h1>{view.question??view.title??'Final'}</h1></>;
      case'WINNER':
        return <><small>WINNER</small><h1>{view.title??'Congratulations!'}</h1></>;
      default:
        return <><small>GERiCARE</small><h1>{view.title??'Quiz will begin shortly'}</h1><p>Get ready.</p></>;
    }
  };

  return (
    <main>
      <div className="status">{connected?'LIVE':'RECONNECTING'}</div>
      <section>{content()}</section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
