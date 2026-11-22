/** A completed audio window with no recognised dialogue, not an ASR/system failure. */
export class NonDialogue extends Error {
 constructor(readonly resumeAt:number,readonly examinedUntil=resumeAt){super('原片继续播放，等待下一句对白。');this.name='NonDialogue';}
}
export class UncertainDialogue extends Error {constructor(){super('这句对白尚未确认。');this.name='UncertainDialogue';}}
export type SearchPhase='preparing'|'listening'|'confirming'|'searching'|'recovering'|'reconnecting'|'waiting-review';
export async function findNextDialogue<T>(options:{
 signal:AbortSignal;position:()=>number;duration:()=>number;
 seek:(ms:number)=>Promise<void>;detect:()=>Promise<T|undefined>;searching:()=>void;
}):Promise<T|undefined>{
 const {signal}=options;let reviewedUntil=-Infinity;
 while(!signal.aborted){
  const start=options.position();if(start>=options.duration()-100)return;
  try{return await options.detect();}
  catch(error){
   if(signal.aborted)throw new DOMException('已暂停','AbortError');
   if(!(error instanceof NonDialogue))throw error;
   // A detector can pause after the candidate end. Preserve that look-ahead;
   // it may already contain the opening of the next speaker's sentence.
   const retry=start<reviewedUntil-100;
   const playedUntil=options.position();
   if(!Number.isFinite(playedUntil)||playedUntil<=start)throw new Error('视频尚未继续播放，请重试；未跳过未播放的片段。');
   // Never seek ahead of what was actually played, even if recognition reports
   // an invalid future boundary. Rewinding already heard context is safe.
   const next=Math.min(options.duration(),playedUntil,Math.max(start+100,retry?Math.max(error.resumeAt,error.examinedUntil):error.resumeAt));
   reviewedUntil=Math.max(reviewedUntil,error.examinedUntil);
   if(!Number.isFinite(next))throw new Error('自动续句时间无效。');
   if(next>=options.duration()-100)return;
   options.searching();if(Math.abs(next-playedUntil)>1)await options.seek(next);
  }
 }
 throw new DOMException('已暂停','AbortError');
}
