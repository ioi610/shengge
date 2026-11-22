import {isDialogueText,TextSentence} from './sentence-confirmation';
import {Segment,uid} from './domain';
export const TIMELINE_VERSION=1;
export type AnalysisWindow={offsetMs:number;durationMs:number;language?:string;segments:TextSentence[]};
export type TimelineCheckpoint={version:number;durationMs:number;originMs:number;windows:AnalysisWindow[];reviewed:number[];complete?:boolean};
const normalized=(text:string)=>text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
export function analysisOffsets(origin:number,duration:number){const offsets:number[]=[];for(let n=origin;n<duration-100;n+=20000)offsets.push(n);return offsets;}
export function validTimedRow(row:TextSentence,duration:number){
 return typeof row.text==='string'&&isDialogueText(row.text)&&row.timing==='aligned'&&Number.isFinite(row.confidence)&&Number.isFinite(row.startMs)&&Number.isFinite(row.endMs)&&row.startMs>=0&&row.endMs>row.startMs&&row.endMs<=duration&&Array.isArray(row.words)&&row.words.length>0&&row.words.every((w,i)=>Number.isFinite(w.startMs)&&Number.isFinite(w.endMs)&&w.startMs>=0&&w.endMs>w.startMs&&w.endMs<=duration&&(i===0||w.startMs>=row.words![i-1].startMs));
}
export function needsReview(window:AnalysisWindow){
 return !window.segments.some(s=>validTimedRow(s,window.durationMs)&&(s.confidence??0)>=.65)||window.segments.some(s=>isDialogueText(s.text)&&(s.confidence??0)>=.25&&((s.confidence??0)<.65||s.endMs>window.durationMs-350||!validTimedRow(s,window.durationMs)));
}
/** Assemble a fixed timeline only after ALL scheduled windows have finished.
 * Weak monosyllables need agreement; a model's music hypothesis never becomes
 * a segment. Timings always come from aligned words, not arbitrary time slices. */
export function timelineSegments(windows:AnalysisWindow[],duration:number,origin=0):Segment[]{
 const candidates=windows.flatMap((window,index)=>window.segments.filter(s=>validTimedRow(s,window.durationMs)).map(s=>({...s,startMs:s.startMs+window.offsetMs,endMs:s.endMs+window.offsetMs,language:window.language,index,
  clipped:window.offsetMs+window.durationMs<duration-100&&s.endMs>window.durationMs-180,
  score:(s.confidence??0)-((s.startMs<180&&window.offsetMs>origin)||(s.endMs>window.durationMs-350&&window.offsetMs+window.durationMs<duration-100)?.15:0)})));
 const accepted=candidates.filter(s=>{
  if(s.clipped)return false;
  const text=normalized(s.text),short=/^(?:ん|う|あ|え|うん|uh|um|hmm)$/iu.test(text);
  if(!short&&(s.confidence??0)>=.65)return true;
  return (s.confidence??0)>=.4&&candidates.some(p=>p.index!==s.index&&normalized(p.text)===text&&Math.max(p.confidence??0,s.confidence??0)>=.65&&Math.abs(p.startMs-s.startMs)<=450&&Math.abs(p.endMs-s.endMs)<=650);
 }).sort((a,b)=>b.score-a.score);
 const chosen:typeof accepted=[];
 for(const s of accepted){
  const conflict=chosen.some(p=>{const overlap=Math.min(p.endMs,s.endMs)-Math.max(p.startMs,s.startMs);return overlap>0&&overlap>=.45*Math.min(p.endMs-p.startMs,s.endMs-s.startMs);});
  if(!conflict)chosen.push(s);
 }
 chosen.sort((a,b)=>a.startMs-b.startMs);
 return chosen.map((s,i)=>{
  const previous=chosen[i-1],next=chosen[i+1];
  const left=previous?(previous.endMs+s.startMs)/2:origin,right=next?(s.endMs+next.startMs)/2:duration;
  return {id:uid(),revision:1,startMs:Math.round(Math.max(origin,left,s.startMs-200)),endMs:Math.round(Math.min(duration,right,s.endMs+320)),text:s.text,confidence:s.confidence,language:s.language,source:'asr' as const,onsetVerified:true,onsetVersion:5};
 }).filter(s=>s.endMs-s.startMs>=160);
}

export function validCheckpoint(value:any,duration:number,origin:number):value is TimelineCheckpoint{
 return Number.isInteger(duration)&&duration>0&&duration<=3600000&&Number.isInteger(origin)&&origin>=0&&origin<duration&&value?.version===TIMELINE_VERSION&&value.durationMs===duration&&value.originMs===origin&&Array.isArray(value.windows)&&value.windows.length<=500&&Array.isArray(value.reviewed)&&value.reviewed.length<=200&&value.reviewed.every((n:unknown)=>Number.isInteger(n)&&Number(n)>=origin&&Number(n)<duration)&&value.windows.every((w:any)=>Number.isInteger(w.offsetMs)&&w.offsetMs>=origin&&w.offsetMs<duration&&Number.isInteger(w.durationMs)&&w.durationMs>=1000&&w.durationMs<=24000&&w.offsetMs+w.durationMs<=duration+1000&&Array.isArray(w.segments)&&w.segments.length<=200&&w.segments.every((s:any)=>typeof s?.text==='string'&&s.text.length<=2000&&Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)));
}
