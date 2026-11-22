import type {Transcript} from './background-captions';
import {isDialogueText,unfinishedClause} from './sentence-confirmation';

/** Text review only corroborates an existing speaker candidate. Timed words
 * outside that candidate, music labels and clipped endings cannot create loops. */
export function reviewedTurn(result:Transcript|undefined,candidate:{startMs:number;endMs:number;reason?:'speaker-change'|'turn-end'},duration:number,ended=false){
 if(!result)return;
 for(const row of result.segments){
 if(!isDialogueText(row.text)||row.timing!=='aligned'||(row.confidence??0)<.6||unfinishedClause(row.text))continue;
 // A lone humming token cannot validate several seconds of unsupported noise.
 const spoken=row.text.normalize('NFKC').replace(/[ー〜～\s\p{P}\p{S}]/gu,'');
 if(Array.from(spoken).length<=1&&candidate.endMs-candidate.startMs>1200)continue;
 if(!Number.isFinite(row.startMs)||!Number.isFinite(row.endMs)||row.startMs<0||row.endMs<=row.startMs||row.endMs>duration)continue;
 const words=row.words?.filter(w=>/[\p{L}\p{N}]/u.test(w.text));
 if(!words?.length||words.some((w,i)=>!Number.isFinite(w.startMs)||!Number.isFinite(w.endMs)||w.startMs<0||w.endMs<=w.startMs||w.endMs>duration||i>0&&w.startMs<words[i-1].startMs))continue;
 if(row.startMs>candidate.endMs||row.endMs<candidate.startMs||row.startMs<candidate.startMs-600||row.endMs>candidate.endMs+2400)continue;
 if(candidate.reason==='speaker-change'&&row.endMs>candidate.endMs+100)continue;
 if(!ended&&duration-row.endMs<160)continue;
 return {startMs:Math.max(0,Math.min(candidate.startMs,row.startMs-200)),endMs:candidate.reason==='speaker-change'?candidate.endMs:Math.min(duration,Math.max(candidate.endMs,row.endMs+320)),text:row.text,confidence:row.confidence,language:result.language};
 }
}

/** With no established language, a single confident hallucination over music
 * is insufficient. Require agreement from a separately cropped decode. */
export function agreeingReview(first:ReturnType<typeof reviewedTurn>,second:ReturnType<typeof reviewedTurn>,offset:number){
 if(!first||!second||!first.language||first.language==='auto'||first.language!==second.language)return;
 const normalized=(s:string)=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLocaleLowerCase();
 if(normalized(first.text)!==normalized(second.text)||Math.abs(first.startMs-second.startMs-offset)>400||Math.abs(first.endMs-second.endMs-offset)>400)return;
 return {...first,startMs:Math.min(first.startMs,second.startMs+offset),endMs:Math.max(first.endMs,second.endMs+offset),confidence:Math.min(first.confidence!,second.confidence!)};
}
