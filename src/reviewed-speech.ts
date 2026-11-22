import type {Transcript} from './background-captions';
import type {PendingTurn} from './pending-turns';
import {isDialogueText} from './sentence-confirmation';

export type ReviewEvidence={frames:number[];focused:boolean};
type Attempt={frames:Set<number>;firstIsland:Set<number>;focused:boolean;language?:string};

/** Avoid re-decoding the same corroborated voice after a completed negative
 * review. This is an attempt identity, not a claim that the audio is silent.
 * A timeout, new voice bin, independent island, speaker change or new language
 * still permits review. Call the original acoustic gate before consulting it. */
export class ReviewedSpeech {
 private attempts:Attempt[]=[];
 remember(turn:PendingTurn,evidence:ReviewEvidence,result:Transcript|undefined,language?:string){
  // Confidence/timing failures are different: a useful transcript with poor
  // alignment may still improve under another crop. Keep that retry available.
  if(!result||turn.reason==='speaker-change'||result.segments.some(row=>isDialogueText(row.text)&&(row.confidence??0)>=.6))return;
  const frames=[...new Set(evidence.frames)].sort((a,b)=>a-b);
  if(frames.length<5)return;
  const firstIsland:number[]=[];
  for(const frame of frames){
   // Use the detector's existing 950 ms closing pause, not a new confidence
   // threshold. A later island inside a coarse proposal remains independent.
   if(firstIsland.length&&(frame-firstIsland.at(-1)!)*32>=950)break;
   firstIsland.push(frame);
  }
  this.attempts.push({frames:new Set(frames),firstIsland:new Set(firstIsland),focused:evidence.focused,language});
  this.attempts=this.attempts.slice(-32);
 }
 has(turn:PendingTurn,evidence:ReviewEvidence,language?:string){
  if(turn.reason==='speaker-change'||evidence.frames.length<5)return false;
  const first=Math.min(...evidence.frames);
  return this.attempts.some(attempt=>attempt.focused===evidence.focused&&attempt.language===language&&attempt.firstIsland.has(first)&&evidence.frames.every(frame=>attempt.frames.has(frame)));
 }
}
