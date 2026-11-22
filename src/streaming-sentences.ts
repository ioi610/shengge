import {recognitionDeadlineMs} from './recognition-timeout';
import {extensionAsr,AsrTransport} from './local-asr-client';
import {encodePcmWav,SentenceConfirmation,TextSentence,isDialogueText,isMusicText} from './sentence-confirmation';
import {transcriptForUtterance} from './utterance-transcript';
import {NonDialogue,UncertainDialogue} from './dialogue-search';
import {alignedSpeechOnset} from './speech-onset';
import {SpeechOnset} from './speech-onset';
import type {SpeakerFrame} from './speaker-turns';
declare const __SHENGGE_QA__:boolean;
export class StreamingSentences {
 private preservedTurn?:{startMs:number;endMs:number;reason?:'speaker-change'|'turn-end'};private turnHadDialogue=false;
 private alignmentWitness?:{offset:number;start:number;end:number;text:string};
 private samples:number[]=[];private times:number[]=[];private previousRun=0;private busy=false;private controller=new AbortController();private confirmation=new SentenceConfirmation();private pending=false;private turn?:{startMs:number;endMs:number;reason?:'speaker-change'|'turn-end'};private finalRuns=0;private accepted=false;private speechStart?:number;private speechFrames=0;private onset=new SpeechOnset();private focusedOnset=new SpeechOnset();private noDialogue=false;private sawDialogue=false;private musicRuns=0;private retrySpeechAt?:number;private failed=false;private cropRuns=0;private hardEnd=false;private cached?:{offset:number;length:number;result:any};
 constructor(private origin:number,private accept:(s:TextSentence)=>void,private error:(e:Error)=>void,private transport:AsrTransport=extensionAsr,private language?:string,private holdUntilEnd=false,private allowContinuation=false){}
 observeSpeech(frames:SpeakerFrame[],focused=false){(focused?this.focusedOnset:this.onset).observe(frames);}
 /** Snapshot only the existing repeated speaker evidence. These PCM-clock
  * bins identify attempted voice without making a new speech decision. */
 reviewEvidence(turn:{startMs:number;endMs:number;focused?:boolean}){
  const a=Math.max(0,this.times.findIndex(t=>t>=turn.startMs))*32;
  const b=this.times.findIndex(t=>t>=turn.endMs),end=b<0?this.samples.length/16:(b+1)*32;
  return {frames:(turn.focused?this.focusedOnset:this.onset).reviewSupport(a,end),focused:!!turn.focused};
 }
 /** Confirm acoustic turns without treating their padded starts as word anchors. */
 acousticBoundary(turn:{startMs:number;endMs:number;reason?:'speaker-change'|'turn-end';leadingStartMs?:number;focused?:boolean},ended=false){
  const evidence=turn.focused?this.focusedOnset:this.onset;
  const a=Math.max(0,this.times.findIndex(t=>t>=turn.startMs))*32;
  const b=this.times.findIndex(t=>t>=turn.endMs),end=b<0?this.samples.length/16:(b+1)*32;
  // The raw model may call a confidence dip a pause while the independent
  // voice-band view still hears ongoing speech. Hold the provisional pause;
  // a later full boundary or text review can settle it without clipping words.
  if(!ended&&turn.reason!=='speaker-change'&&this.focusedOnset.ongoingVoice(end+320,this.samples.length/16))return;
  const lead=turn.leadingStartMs;
  const start=lead!==undefined&&Number.isFinite(lead)&&lead<=turn.startMs&&turn.startMs-lead<=1400?lead:turn.startMs;
  // Speaker-only certainty after a long musical gap also describes chewing
  // and title effects. Keep those candidates for text review unless VAD and
  // speaker evidence jointly anchor a word. Nearby replies retain the fast path.
  if(start-this.origin>2500&&evidence.wordStart(a,end)===undefined)return;
  const direct=evidence.acousticStart(a,end,false);
  const onset=direct??(this.allowContinuation&&this.origin>0?evidence.continuationStart(a,end):undefined)??evidence.acousticStart(a,end);
  if(onset===undefined||turn.endMs-turn.startMs<160)return;
  // Preserve breathy final consonants/quiet last words that both classifiers
  // under-score. This margin is only for a pause, never a speaker change.
  // Speaker-only quiet speech has less reliable final-consonant evidence.
  // Retain extra audio inside the 950ms closing pause; never cross an explicit
  // speaker change. A fast response must not be bought by clipping the suffix.
  const tail=Math.min(this.samples.length/16,evidence.tail(a,end)+(direct===undefined||evidence.wordStart(a,end)===undefined?640:320));
  if(!ended&&turn.reason!=='speaker-change'&&tail>this.samples.length/16-160)return;
  return {startMs:Math.max(this.origin,Math.min(start,this.media(onset))),endMs:turn.reason==='speaker-change'?turn.endMs:Math.max(turn.endMs,this.media(tail))};
 }
 reviewAudio(turn:{startMs:number;endMs:number;reason?:'speaker-change'|'turn-end';focused?:boolean},ended=false){
  if(!Number.isFinite(turn.startMs)||!Number.isFinite(turn.endMs)||turn.endMs<=turn.startMs||turn.startMs>(this.times.at(-1)??this.origin))return;
  const a=Math.max(0,this.times.findIndex(t=>t>=turn.startMs))*32;
  const b=this.times.findIndex(t=>t>=turn.endMs),end=b<0?this.samples.length/16:(b+1)*32;
  if(!(turn.focused?this.focusedOnset:this.onset).canReview(a,end)||!ended&&this.samples.length/16-end<960)return;
  // A queued review must inspect the candidate, not every later reply captured
  // while waiting for the decoder. Preserve the closing quiet tail only.
  // Include the replay lead-in in this decode, so a successful aligned review
  // can also provide its subtitle without a second ASR request.
  const start=Math.max(0,a-960),stop=Math.min(this.samples.length/16,end+960,start+12000);
  if(end>stop)return;
  const pcm=Float32Array.from(this.samples.slice(start*16,stop*16));
  let energy=0;for(const x of pcm)energy+=x*x;if(pcm.length<16000||Math.sqrt(energy/pcm.length)<.003)return;
  return {pcm,candidate:{startMs:a-start,endMs:end-start,reason:turn.reason},toMedia:(ms:number)=>this.media(start+ms),ended};
 }
 audioFor(turn:{startMs:number;endMs:number}){
  const a=Math.max(0,this.times.findIndex(t=>t>=turn.startMs))*512;
  const b=this.times.findIndex(t=>t>=turn.endMs);
  return Float32Array.from(this.samples.slice(a,b<0?this.samples.length:(b+1)*512));
 }
 /** Use only captured audio, including a small already-heard closing margin.
  * This never extends a replay boundary or requests a forward media seek. */
 captionAudio(turn:{startMs:number;endMs:number}){
  const startMs=Math.max(this.origin,turn.startMs-1600);
  const utterance=this.audioFor(turn),before=this.audioFor({...turn,startMs});
  const pcm=this.audioFor({startMs,endMs:turn.endMs+320});
  const first=Math.max(0,this.times.findIndex(t=>t>=startMs));
  return {pcm,mediaStartMs:this.media(first*32),prefixMs:Math.max(0,before.length-utterance.length)/16,suffixMs:Math.max(0,pcm.length-before.length)/16};
 }
 markSpeechStart(ms:number){if(this.speechStart===undefined)this.speechStart=Math.max(0,Math.floor(Math.max(0,ms-1600)/32)*512);}
 push(frame:Float32Array,time:number,speechProbability=1){
  if(this.controller.signal.aborted)return;for(const x of frame)this.samples.push(x);this.times.push(time);this.onset.push(speechProbability);this.focusedOnset.push(speechProbability);
  if(this.speechStart===undefined){this.speechFrames=speechProbability>=.5?this.speechFrames+1:0;if(this.speechFrames>=3)this.speechStart=Math.max(0,this.samples.length-frame.length*64);}
  if(!this.holdUntilEnd&&this.speechStart!==undefined&&this.samples.length-this.speechStart>=32000&&this.samples.length-this.previousRun>=16000){if(this.busy){this.pending=true;return;}void this.run();}
 }
 private media(ms:number){const frame=ms/32,i=Math.floor(frame),a=i===0?this.origin:this.times[Math.min(i-1,this.times.length-1)],b=this.times[Math.min(i,this.times.length-1)];return Math.round(a+(b-a)*(frame-i));}
 private async run(){
  if(this.busy||this.controller.signal.aborted)return;if(this.speechStart===undefined){if(this.turn)this.error(new NonDialogue(this.turn.endMs));return;}this.busy=true;this.pending=false;this.previousRun=this.samples.length;let id:string|undefined;
  try{
   const offset=this.speechStart;const audio=encodePcmWav(Float32Array.from(this.samples.slice(offset)));let binary='';for(let i=0;i<audio.length;i+=32768)binary+=String.fromCharCode(...audio.subarray(i,i+32768));
   if(this.cached?.offset!==offset||this.cached?.length!==this.previousRun)id=(await this.transport('submit',{audio:btoa(binary),...(this.language?{language:this.language}:{}),durationMs:Math.round((this.samples.length-offset)/16)})).id;
   const deadline=Date.now()+recognitionDeadlineMs((this.previousRun-offset)/16);
   while(!this.controller.signal.aborted){
    if(Date.now()>deadline)throw new Error('这句的识别耗时较长，已暂停。点击“重试识别”从原位置继续。');
    const status=id?await this.transport('status',{id}):{state:'done',result:this.cached!.result};if(status.state==='error')throw new Error(status.error);
    if(status.state==='done'){
     const result=status.result;this.cached={offset,length:this.previousRun,result};this.sawDialogue||=Boolean(result?.segments?.some((s:TextSentence)=>isDialogueText(s.text)));this.musicRuns=result?.segments?.length&&result.segments.every((s:TextSentence)=>isMusicText(s.text)&&(s.confidence??0)>=.4)?this.musicRuns+1:0;this.noDialogue=!this.sawDialogue;if(!result?.streaming)throw new Error('请更新并重启本机识别服务，以启用完整句判断。');
     for(const s of result.segments as TextSentence[]){if(this.retrySpeechAt===undefined&&isDialogueText(s.text)&&(s.confidence??0)>=.6&&offset/16+s.startMs>1000)this.retrySpeechAt=this.media(offset/16+Math.max(0,s.startMs-800));}
     // Text may arrive before the voice has finished. Never loop an ASR row
     // merely because it has punctuation or the decoder emitted another row.
     const boundaryFrame=this.turn?this.times.findIndex(time=>time>=this.turn!.endMs):-1;
     const boundaryMs=(boundaryFrame>=0?(boundaryFrame+1)*32:this.previousRun/16)-offset/16;
     const utterance=this.turn?transcriptForUtterance(result.segments,boundaryMs,this.turn.reason==='speaker-change'):[];
     const firstUtterance=utterance.find(row=>isDialogueText(row.text));if(this.turn)this.turnHadDialogue=Boolean(firstUtterance);
     const voice=firstUtterance?this.onset.resolve(offset/16+firstUtterance.startMs,offset/16+firstUtterance.endMs):undefined;
     // A quiet/interjection opening may be missed by the classifier while the
     // following words in the SAME aligned utterance are clearly speech. Use
     // that evidence to retain its first token, never to trim to the later hit.
     const anchored=firstUtterance?this.onset.wordStart(offset/16+firstUtterance.startMs,offset/16+firstUtterance.endMs,false,firstUtterance.timing==='aligned'):undefined;
     let acousticSupport=anchored!==undefined||Boolean(firstUtterance&&voice!==undefined&&(voice<=offset/16+firstUtterance.startMs+320||firstUtterance.timing==='aligned'&&(firstUtterance.words?.length??0)>=2&&voice<=offset/16+firstUtterance.startMs+1200));
     const normalized=firstUtterance?.text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'');
     if(!acousticSupport&&this.turn&&firstUtterance?.timing==='aligned'&&(firstUtterance.confidence??0)>=.45&&(firstUtterance.words?.length??0)>=2){
      const start=offset/16+firstUtterance.startMs,end=offset/16+(firstUtterance.words?.filter(word=>/[\p{L}\p{N}]/u.test(word.text)).at(-1)?.startMs??firstUtterance.endMs),witness=this.alignmentWitness;
      if(witness&&witness.offset!==offset&&witness.text===normalized&&Math.abs(witness.start-start)<=320&&Math.abs(witness.end-end)<=320)acousticSupport=true;
      else if(!witness&&this.cropRuns<2){
       const nextOffset=Math.floor(Math.max(offset/16,start-(firstUtterance.startMs>600?600:320))/32)*512;
       if(nextOffset>offset){
        this.alignmentWitness={offset,start,end,text:normalized!};this.speechStart=nextOffset;this.cropRuns++;this.confirmation=new SentenceConfirmation();this.finalRuns=0;this.pending=true;
       }
      }
     }
     const confirmed=this.turn?this.confirmation.accept(utterance,(this.previousRun-offset)/16,true,acousticSupport):undefined;
     let onset=confirmed?this.onset.wordStart(offset/16+confirmed.startMs,offset/16+confirmed.endMs,(confirmed.confidence??0)>=.9||this.confirmation.stableReadings>=3&&(confirmed.confidence??0)>=.6,confirmed.timing==='aligned'):undefined;
     if(confirmed&&onset===undefined&&confirmed.timing==='aligned'&&((confirmed.confidence??0)>=.8||acousticSupport&&(confirmed.confidence??0)>=.45))onset=alignedSpeechOnset(this.samples,offset/16+confirmed.startMs,offset/16+confirmed.endMs);
     if(typeof __SHENGGE_QA__!=='undefined'&&__SHENGGE_QA__)console.debug('[声格分句]',JSON.stringify({origin:this.origin,offset:offset/16,boundaryMs,turn:this.turn,rows:result.segments,utterance,voice,acousticSupport,confirmed,onset}));
     if(confirmed&&onset!==undefined&&!this.controller.signal.aborted){const startMs=this.media(onset),rawEnd=this.media(confirmed.endMs+offset/16),endMs=this.turn&&this.hardEnd?Math.min(rawEnd,this.turn.endMs):rawEnd;if(endMs>startMs){this.accepted=true;this.accept({...confirmed,language:result.language,startMs,endMs,text:rawEnd>endMs+150?'':confirmed.text});}}
     // Long musical lead-ins can shift Whisper word timestamps away from the
     // acoustic onset. Re-decode the cached candidate with a short lead-in;
     // do not replay the video, skip the words, or accept a fabricated onset.
     if(confirmed&&onset===undefined&&this.cropRuns<2&&confirmed.startMs>850&&this.onset.wordStart(offset/16+confirmed.startMs,offset/16+confirmed.endMs,true)===undefined){
      this.speechStart=Math.floor((offset/16+confirmed.startMs-350)/32)*512;this.cropRuns++;this.confirmation=new SentenceConfirmation();this.finalRuns=0;this.pending=true;
     }
     // A music hypothesis over a long window can mask real words at its end.
     // Before skipping, re-decode around a later acoustic/speaker candidate.
     // This is only a request for better evidence, never a loop boundary.
     const voiceCandidate=this.onset.resolve(offset/16,this.previousRun/16);
     const turnFrame=this.turn?this.times.findIndex(time=>time>=this.turn!.startMs):-1;
     const turnCandidate=turnFrame>=0?turnFrame*32:undefined;
     const candidate=[voiceCandidate,turnCandidate].filter((n):n is number=>n!==undefined&&n>offset/16+850).sort((a,b)=>a-b)[0];
     if(!this.accepted&&this.turn&&this.noDialogue&&this.cropRuns<2&&candidate!==undefined){
      this.speechStart=Math.floor(Math.max(offset/16,candidate-350)/32)*512;this.cropRuns++;this.confirmation=new SentenceConfirmation();this.finalRuns=0;this.pending=true;
     }
     const first=(result.segments as TextSentence[]).find(s=>isDialogueText(s.text));
     // A weak opening can be a quiet first word, not necessarily noise.
     // Re-decode WITH that opening; cropping to the confident later row
     // permanently loses the prefix and can turn half a sentence into a loop.
     const next=(result.segments as TextSentence[]).find(s=>s!==first&&isDialogueText(s.text)&&s.timing==='aligned'&&(s.confidence??0)>=.8&&s.startMs>(first?.endMs??Infinity)&&s.endMs-s.startMs>=200);
     if(!this.accepted&&this.turn&&this.finalRuns>=1&&this.cropRuns<2&&first&&(first.confidence??0)<.6&&next&&this.onset.resolve(offset/16+first.startMs,offset/16+first.endMs,true)===undefined){
      const nextOffset=Math.floor((offset/16+Math.max(0,first.startMs-600))/32)*512;
      if(nextOffset>offset){this.speechStart=nextOffset;this.cropRuns++;this.confirmation=new SentenceConfirmation();this.finalRuns=0;this.pending=true;}
     }
     const acoustic=this.onset.resolve(offset/16,(this.previousRun)/16);
     if(!this.accepted&&!this.pending&&this.cropRuns<2&&first&&(first.confidence??0)<.6&&acoustic!==undefined&&acoustic>offset/16+first.endMs+600){
      this.speechStart=Math.floor(Math.max(0,acoustic-350)/32)*512;this.cropRuns++;this.confirmation=new SentenceConfirmation();this.finalRuns=0;this.pending=true;
     }
     break;
    }
    await new Promise(r=>setTimeout(r,120));
   }
  }catch(e){this.failed=true;if(!this.controller.signal.aborted)this.error(e as Error);}
  finally{if(id)void this.transport('cancel',{id}).catch(()=>{});this.busy=false;if(this.turn&&!this.failed&&!this.accepted&&++this.finalRuns<4)this.pending=true;if(this.turn&&!this.failed&&!this.accepted&&this.finalRuns>=4&&!this.controller.signal.aborted)this.error((this.noDialogue||this.musicRuns>=3)&&this.onset.resolve(0,this.samples.length/16)===undefined?new NonDialogue(Math.min(this.turn.endMs,this.retrySpeechAt??this.turn.endMs),this.turn.endMs):new UncertainDialogue());if(this.pending&&!this.failed&&!this.controller.signal.aborted)void this.run();}
 }
 finish(turn:{startMs:number;endMs:number;reason?:'speaker-change'|'turn-end'},hardEnd=true){if(this.controller.signal.aborted)return;if(typeof __SHENGGE_QA__!=='undefined'&&__SHENGGE_QA__){const audio=encodePcmWav(Float32Array.from(this.samples));let binary='';for(let i=0;i<audio.length;i+=32768)binary+=String.fromCharCode(...audio.subarray(i,i+32768));void this.transport('qa-capture',{audio:btoa(binary),origin:this.origin}).catch(()=>{});}this.turn=this.preservedTurn??turn;this.hardEnd=this.preservedTurn?false:hardEnd;if(this.busy)this.pending=true;else void this.run();}
 reopen(){if(this.turnHadDialogue&&this.turn?.reason)this.preservedTurn??=this.turn;this.turn=undefined;this.hardEnd=false;this.finalRuns=0;this.pending=false;}
 stop(){this.controller.abort();this.samples=[];this.times=[];this.cached=undefined;}
}
