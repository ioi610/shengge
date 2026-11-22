type Word={word:string;start:number;end:number;probability:number;t_dtw?:number};
export type TranscriptRow={start:number;end:number;text:string;no_speech_prob?:number;words?:Word[]};
const terminal=/[。！？.!?؟۔।][”’"」』）)\]]*$/u;
/** Speaker labels emitted by ASR are metadata, not a spoken first word.
 * Remove only a balanced annotation at the start of a clause, retaining the
 * original acoustic timestamp of the first spoken token (including えっ etc.). */
function withoutSpeakerPrefix(group:Word[]):Word[]{
 const text=group.map(w=>w.word).join('');
 const prefix=text.match(/^\s*(?:[（(][^()（）]{1,24}[)）]|\[[^\[\]]{1,24}\])\s*(?=[\p{L}\p{N}])/u)?.[0];
 if(!prefix)return group;
 let remaining=prefix.length;
 return group.flatMap(w=>{const cut=Math.min(remaining,w.word.length);remaining-=cut;const word=w.word.slice(cut);return word?[{...w,word}]:[];});
}
export function streamingTranscriptSegments(rows:TranscriptRow[],durationMs:number){
 return rows.filter(s=>(s.no_speech_prob??0)<.7&&s.text.trim()&&!/^\s*[[(].*[\])]\s*$/.test(s.text)).flatMap(s=>{
  const raw=s.words??[];
  const aligned=raw.length>0&&raw.every((w,i)=>Number.isFinite(w.t_dtw)&&w.t_dtw!>=0&&w.t_dtw!*10<durationMs&&(i===0||w.t_dtw!>=raw[i-1].t_dtw!));
  // whisper.cpp can return inverted token times after a music/silence gap.
  // Dropping those tokens silently removes the beginning of the sentence.
  if(!aligned&&raw.some(w=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.end<w.start)){
   const clauses=s.text.split(/[。！？.!?؟۔।]+/u).filter(t=>/[\p{L}\p{N}]/u.test(t));
   if(clauses.length!==1||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start)return [];
   return [{startMs:Math.max(0,Math.round(s.start*1000)),endMs:Math.min(durationMs,Math.round(s.end*1000)),text:s.text.trim(),confidence:raw.reduce((sum,w)=>sum+w.probability,0)/raw.length}];
  }
  const words=aligned?raw.map(w=>({...w,start:w.t_dtw!*.01,end:Math.min(durationMs/1000,w.t_dtw!*.01+.16)})):raw;
  if(!words.some(w=>w.end>w.start)){
   // Some short replies have text and row timing but no word timestamps.
   // Keep a single acoustic candidate instead of silently losing that reply.
   const clauses=s.text.split(/[。！？.!?؟۔।]+/u).filter(t=>/[\p{L}\p{N}]/u.test(t));
   if(clauses.length!==1||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start)return [];
   return [{startMs:Math.max(0,Math.round(s.start*1000)),endMs:Math.min(durationMs,Math.round(s.end*1000)),text:s.text.trim(),confidence:raw.length?raw.reduce((n,w)=>n+w.probability,0)/raw.length:0}];
  }
  const groups:Word[][]=[];let pending:Word[]=[];
  for(const w of words){pending.push(w);const line=pending.map(x=>x.word).join('').trim();if(terminal.test(line)&&!/\b(?:Mr|Mrs|Ms|Dr|Prof|etc)\.$/i.test(line)){groups.push(pending);pending=[];}}
  if(pending.length)groups.push(pending);
  return groups.map(withoutSpeakerPrefix).filter(group=>group.length).map(group=>({startMs:Math.max(0,Math.round(group[0].start*1000)),endMs:Math.min(durationMs,Math.round(group.at(-1)!.end*1000)),text:group.map(w=>w.word).join('').trim(),confidence:group.reduce((sum,w)=>sum+w.probability,0)/group.length,...(aligned?{timing:'aligned' as const,words:group.map(w=>({startMs:Math.round(w.start*1000),endMs:Math.round(w.end*1000),text:w.word}))}:{})}));
 }).filter(s=>s.endMs>s.startMs&&s.text&&!/^\s*[[(].*[\])]\s*$/.test(s.text));
}
