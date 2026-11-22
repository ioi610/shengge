import type {Transcript} from './background-captions';
import type {TextSentence} from './sentence-confirmation';
import {isDialogueText} from './sentence-confirmation';
import {languageEvidence} from './source-language';

export type CaptionEvidenceRange={start:number;end:number;audioEnd:number;mediaStartMs:number;rate:number};
const letters=(text:string)=>text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const valid=(r:CaptionEvidenceRange)=>[r.start,r.end,r.audioEnd,r.mediaStartMs,r.rate].every(Number.isFinite)&&r.start>=0&&r.end>r.start&&r.audioEnd>=r.end&&r.mediaStartMs>=0&&r.rate>0;
/** Retain a naturally aligned final word crossing the target by at most 160 ms,
 * only inside audio actually captured. Never make a clipped row into evidence. */
export function completeCaptionRow(row:TextSentence,r:CaptionEvidenceRange){
 return valid(r)&&row.timing==='aligned'&&isDialogueText(row.text)&&Number.isFinite(row.confidence)&&(row.confidence??0)>=.6&&Number.isFinite(row.startMs)&&Number.isFinite(row.endMs)&&row.startMs>=r.start&&row.endMs>row.startMs&&row.endMs<=Math.min(r.end+160,r.audioEnd)&&Boolean(row.words?.length)&&row.words!.every((w,i)=>Number.isFinite(w.startMs)&&Number.isFinite(w.endMs)&&w.startMs>=row.startMs&&w.startMs>=r.start&&w.startMs<r.end&&w.endMs>w.startMs&&w.endMs<=row.endMs&&w.endMs<=Math.min(r.end+160,r.audioEnd)&&(i===0||w.startMs>=row.words![i-1].startMs))&&letters(row.text)===letters(row.words!.map(w=>w.text).join(''));
}

/** Each token is the actual completed decoder result, shared by all its rows.
 * A vote consumes every target range heard in that decode, not just the chosen
 * row, so a later rolling recomputation cannot vote with another old row. */
export class CaptionLanguageEvidence {
 private decodes=new WeakSet<Transcript>();private covered:{start:number;end:number}[]=[];
 reset(){this.decodes=new WeakSet();this.covered=[];}
 observe(result:Transcript,ranges:CaptionEvidenceRange[],longEvidence=false){
  if(this.decodes.has(result))return;this.decodes.add(result);
  const windows=ranges.filter(valid);
  const candidates=windows.flatMap(r=>result.segments.filter(row=>completeCaptionRow(row,r)&&languageEvidence(row.text,result.language)).map(row=>({text:row.text,language:result.language,start:r.mediaStartMs+(row.startMs-r.start)*r.rate,end:r.mediaStartMs+(row.endMs-r.start)*r.rate}))).filter(c=>!this.covered.some(p=>c.start<p.end&&c.end>p.start)).sort((a,b)=>b.end-a.end);
  const selected=candidates[0];
  if(longEvidence||selected){
   const intervals=[...this.covered,...windows.map(r=>({start:r.mediaStartMs,end:r.mediaStartMs+(r.audioEnd-r.start)*r.rate}))].sort((a,b)=>a.start-b.start);
   this.covered=[];for(const interval of intervals){const prior=this.covered.at(-1);if(prior&&interval.start<=prior.end)prior.end=Math.max(prior.end,interval.end);else this.covered.push({...interval});}
  }
  return longEvidence?undefined:selected;
 }
}
