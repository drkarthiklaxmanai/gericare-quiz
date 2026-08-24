export type PresentationState = 'WAITING'|'RULES'|'QUESTION'|'ANSWER_REVEAL'|'EXPLANATION'|'ROUND_TOP10'|'LEADERBOARD'|'FINAL'|'WINNER';
export type ControlAction = 'open_round'|'close_round'|'release_results'|'void_question'|'show_rules'|'show_question'|'show_answer'|'show_explanation'|'show_top10'|'show_leaderboard'|'start_final'|'start_sudden_death'|'winner';
export const presentationOrder: PresentationState[]=['WAITING','RULES','QUESTION','ANSWER_REVEAL','EXPLANATION','ROUND_TOP10','LEADERBOARD','FINAL','WINNER'];
export function isValidTransition(from:PresentationState,to:PresentationState){if(from==='WINNER')return false;return presentationOrder.indexOf(to)>=presentationOrder.indexOf(from)||to==='WAITING'}
export function remainingSeconds(deadline:string|null,now=Date.now()){if(!deadline)return 0;return Math.max(0,Math.ceil((new Date(deadline).getTime()-now)/1000))}
