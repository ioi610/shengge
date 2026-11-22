import type {AsrTransport} from './local-asr-client';
import {prepareRecognition} from './recognition-ready';
import {encodePcmWav,isDialogueText,TextSentence} from './sentence-confirmation';

export type Caption={text:string;language?:string;confidence:number};
export type Transcript={segments:TextSentence[];language?:string};
/** Restore the captured-audio clock after optional caption-only decoder padding.
 * Padding is not speech and must never appear in subtitle text or timestamps. */
export function unpadCaption(result:Transcript,ms:number):Transcript{
 if(!ms)return result;
 return {...result,segments:result.segments.filter(row=>row.endMs>ms).flatMap(row=>{
  const words=row.words?.filter(word=>word.endMs>ms).map(word=>({...word,startMs:Math.max(0,word.startMs-ms),endMs:word.endMs-ms}));
  if(row.words?.length&&!words?.length)return [];
  return [{...row,startMs:Math.max(0,row.startMs-ms),endMs:row.endMs-ms,...(words?{words,text:words.length!==row.words!.length?words.map(w=>w.text).join('').trim():row.text}:{})}];
 })};
}
type Task={pcm:Float32Array;language?:string;deadline:number;review:boolean;interrupted?:boolean;resolve:(result:Transcript|undefined)=>void};
/** Share one decoder queue between optional captions and uncertain-turn review.
 * Keep a bounded FIFO for captions; reviews take priority without deleting captions.
 * Deadlines include queue time, and preempted work resumes after the review. */
export class BackgroundCaptions {
 private pending:Task[]=[];private activeTask?:Task;private active?:AbortController;private disposed=false;private activeReview=false;
 constructor(private transport:AsrTransport){}
 async enqueue(pcm:Float32Array,language?:string):Promise<Caption|undefined>{
  const result=await this.transcribe(pcm,language,30000,false);if(!result)return;
  const dialogue=result.segments.filter(s=>isDialogueText(s.text));
  if(dialogue.length&&dialogue.every(s=>Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)&&s.startMs>=0&&s.endMs>s.startMs&&s.startMs<pcm.length/16&&(s.confidence??0)>=.6&&(!s.words||s.words.filter(w=>/[\p{L}\p{N}]/u.test(w.text)).every(w=>w.endMs>w.startMs&&w.startMs>=0&&w.startMs<pcm.length/16))))return {text:dialogue.map(s=>s.text.trim()).join('\n'),confidence:Math.min(...dialogue.map(s=>s.confidence!)),language:result.language};
 }
 transcribe(pcm:Float32Array,language?:string,timeoutMs=8000,review=true):Promise<Transcript|undefined>{
  if(this.disposed||pcm.length<1600)return Promise.resolve(undefined);
  return new Promise(resolve=>{
   if(review){for(const old of this.pending.filter(t=>t.review))old.resolve(undefined);this.pending=this.pending.filter(t=>!t.review);}
   if(this.pending.length>=8){resolve(undefined);return;}
   this.pending.push({pcm,language,deadline:Date.now()+timeoutMs,review,resolve});
   if(review&&this.activeTask&&!this.activeReview){this.activeTask.interrupted=true;this.active?.abort();}void this.pump();
  });
 }
 private async pump(){
  if(this.active||this.disposed||!this.pending.length)return;
  const index=this.pending.findIndex(t=>t.review),task=this.pending.splice(index<0?0:index,1)[0];
  if(task.deadline<=Date.now()){task.resolve(undefined);void this.pump();return;}
  this.activeTask=task;task.interrupted=false;this.activeReview=task.review;const controller=this.active=new AbortController();let id:string|undefined,transcript:Transcript|undefined;
  const timer=setTimeout(()=>controller.abort(),Math.max(0,task.deadline-Date.now()));
  try{
   await prepareRecognition(this.transport,controller.signal,()=>{});
   // The decoder accepts at least one second; zero padding is not extra speech.
   // For short captions in an established language, a quiet lead-in avoids the decoder's
   // left edge. It adds no ASR request or media wait; review timing is unchanged.
   const prefix=!task.review&&task.language&&task.pcm.length<=64000?2560:0;
   const pcm=new Float32Array(Math.max(16000,task.pcm.length+prefix));pcm.set(task.pcm,prefix);
   const bytes=encodePcmWav(pcm);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   controller.signal.throwIfAborted();
   id=(await this.transport('submit',{audio:btoa(binary),durationMs:Math.round(pcm.length/16),...(task.language?{language:task.language}:{})})).id;
   while(!controller.signal.aborted){
    const status=await this.transport('status',{id});
    if(status.state==='error')break;
    if(status.state==='done'){
     transcript=unpadCaption({segments:(status.result?.segments??[]) as TextSentence[],language:status.result?.language},prefix/16);
     break;
    }
    await new Promise(r=>setTimeout(r,60));
   }
  }catch{/* Recognition/download failures must not pause the listening exercise. */}
  finally{clearTimeout(timer);if(id)await this.transport('cancel',{id}).catch(()=>{});if(task.interrupted&&!this.disposed&&task.deadline>Date.now())this.pending.unshift(task);else task.resolve(controller.signal.aborted?undefined:transcript);if(this.active===controller){this.active=undefined;this.activeTask=undefined;}void this.pump();}
 }
 cancelReview(){if(this.activeReview)this.active?.abort();for(const task of this.pending.filter(t=>t.review))task.resolve(undefined);this.pending=this.pending.filter(t=>!t.review);}
 dispose(){this.disposed=true;this.active?.abort();for(const task of this.pending)task.resolve(undefined);this.pending=[];}
}
