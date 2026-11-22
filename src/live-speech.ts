import {matchesPriorPrint} from './printed-language-history';
import type {Segment} from './domain';
import {VisualCaptionReader} from './visual-caption-reader';
import {VisualTurns,sameJapaneseSpeech,type VisualTurn} from './visual-turns';
import {UnconfirmedVisualTurns} from './unconfirmed-visual-turns';
import {dialogueLeadIn} from './dialogue-lead-in';
import {captionFromReview} from './review-caption';
import {languageCode} from './source-language';
import {OriginalCaptions,type CaptionContext} from './original-captions';
import {reviewedTurn,agreeingReview} from './uncertain-turn';
import {RecognitionTrace,visualCheckOutcome} from './recognition-trace';
import {PendingTurns,PendingTurn} from './pending-turns';
import {ReviewedSpeech} from './reviewed-speech';
import {RemoteTurnModel} from './turn-client';
import {BackgroundCaptions,Caption} from './background-captions';
import {ResumeRecognition,waitForStableMedia,captureDiscontinuity,smallForwardCorrection} from './recognition-resume';
import {SpeechBoundary} from './live-boundary';
import {prepareRecognition} from './recognition-ready';
import {CapturedFrames} from './captured-frames';
import {MicVAD} from '@ricky0123/vad-web';
import {VideoAdapter} from './player';
import {TurnModel,StreamingTurns,TurnAnalyzer,TurnContext} from './turn-model';
import {StreamingSentences} from './streaming-sentences';
import {extensionAsr,AsrTransport} from './local-asr-client';
import {findNextDialogue,SearchPhase,UncertainDialogue,NonDialogue} from './dialogue-search';
declare const __SHENGGE_QA__:boolean;
export type LiveBoundary={startMs:number;endMs:number;text?:string;language?:string;confidence?:number;caption?:Promise<Caption|undefined>};
const endedCaptureSources=new WeakSet<HTMLVideoElement>();
export class LiveSpeech {
 preparationStatus='正在准备离线识别';
 resumePosition?:number;
 private visualReader?:VisualCaptionReader;
 private selectedLanguage?:string;
 private visualBusy=false;
 get detectedLanguage(){return languageCode(this.language);}
 englishRequested=false;
 private printedHints:VisualTurn[]=[];
 referenceAt(segment:{text?:string;startMs:number;endMs:number}){
  return [...this.printedHints].reverse().find(turn=>turn.text===segment.text && Math.min(turn.endMs,segment.endMs)>Math.max(turn.startMs,segment.startMs))?.reference;
 }
 preview?:{text:string;language:string;reference?:string};
 private original:OriginalCaptions;private get language(){return this.original.language;}
 private lastBoundaryEnd?:number;private turnContext?:TurnContext;
 private audioContext:AudioContext;
 private drainFrames=()=>Promise.resolve();private cleanup:Promise<void>=Promise.resolve();private holdingCapture=false;
 private captions:BackgroundCaptions;private turns:TurnAnalyzer;private model:Promise<MicVAD>;private stream?:MediaStream;private frame?:(p:number,frame:Float32Array,time:number,wall:number)=>void;private stop?:()=>void;private disposed=false;
 constructor(private adapter:VideoAdapter,private transport:AsrTransport=extensionAsr,turnAnalyzer?:TurnAnalyzer,private printedHistory:Segment[]=[]){
  if(adapter.video.ended)endedCaptureSources.add(adapter.video);
  this.captions=new BackgroundCaptions(transport);this.original=new OriginalCaptions(this.captions);
  // Let Chrome perform band-limited resampling once. The VAD helper otherwise
  // averages device-rate samples, which changes this quiet voice substantially.
  this.audioContext=new AudioContext({sampleRate:16000});
  const base=typeof chrome!=='undefined'&&chrome.runtime?.id?chrome.runtime.getURL('vad/'):new URL('./vad/',location.href).href;
  this.turns=turnAnalyzer??(transport===extensionAsr?new RemoteTurnModel(transport):new TurnModel(base));
  const capture=async()=>{await this.audioContext.resume();const video=adapter.video as HTMLVideoElement&{captureStream?:()=>MediaStream};if(!video.captureStream)throw new Error('当前播放器无法读取音轨，请使用桌面 Chrome。');this.stream=video.captureStream();this.stream.getVideoTracks().forEach(t=>t.stop());if(!this.stream.getAudioTracks().length)throw new Error('当前视频没有可读取音轨。');return this.stream;};
  const captures=new WeakMap<Float32Array,{owner:NonNullable<LiveSpeech['frame']>;time:number;wall:number}>();
  this.model=MicVAD.new({model:'v5',audioContext:this.audioContext,baseAssetPath:base,onnxWASMBasePath:base,processorType:'AudioWorklet',workletOptions:{channelCount:1,channelCountMode:'explicit',channelInterpretation:'speakers'},startOnLoad:false,getStream:capture,resumeStream:capture,pauseStream:async stream=>stream.getTracks().forEach(t=>t.stop()),ortConfig:ort=>{ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';},onFrameProcessed:(p,frame)=>{const captured=captures.get(frame);if(captured&&this.frame===captured.owner)captured.owner(p.isSpeech,frame,captured.time,captured.wall);}}).then(vad=>{
   const process=vad.processFrame;let received=0,processed=0;
   const queue=new CapturedFrames(()=>adapter.video.seeking||!this.holdingCapture&&(adapter.video.paused||adapter.video.readyState<3)?undefined:this.frame,()=>adapter.position,async(frame,owner,time,wall)=>{captures.set(frame,{owner,time,wall});processed++;await process(frame);},()=>performance.now(),()=>!adapter.video.paused&&!adapter.video.seeking&&adapter.video.readyState>=3);
   this.drainFrames=()=>queue.drain();
   vad.processFrame=frame=>{if(typeof __SHENGGE_QA__!=='undefined'&&__SHENGGE_QA__&&received++%150===0)console.debug('[声格采集]',JSON.stringify({received,processed,time:adapter.position,paused:adapter.video.paused,ready:adapter.video.readyState,owner:!!this.frame}));return queue.push(frame);};return vad;
  });
  // Preload the small detector as the panel opens, without recording or playing.
  void this.model.catch(()=>{});
  // Load an already downloaded model while the user chooses where to start.
  void this.transport('warmup').catch(()=>{});
 }
 useLanguage(language?:string){this.selectedLanguage=languageCode(language);this.original.setLanguage(language);}
 private observeLanguage(text:string,language?:string){this.original.observe(text,language);}
 private caption(pcm:Float32Array,verified?:Caption,context?:CaptionContext){return this.original.enqueue(pcm,verified,context);}
 async detect(signal:AbortSignal,onPhase?:(phase:SearchPhase)=>void,rangeEndMs?:number):Promise<LiveBoundary|undefined>{
  let restarts=0;
  const retained=rangeEndMs===undefined?new UnconfirmedVisualTurns(Math.max(this.adapter.position,this.lastBoundaryEnd??0)):undefined;
  const forget=()=>retained?.clear();
  const events=['seeking','ratechange','emptied'] as const;
  for(const event of events)this.adapter.video.addEventListener(event,forget);
  signal.addEventListener('abort',forget,{once:true});
  const recoverPrinted=(boundary?:LiveBoundary):LiveBoundary|undefined=>{
   signal.throwIfAborted();if(this.disposed)throw new DOMException('已暂停','AbortError');
   if(!this.adapter.valid||this.language&&languageCode(this.language)!=='ja'){forget();return boundary;}
   if(languageCode(this.original.audioConfirmedLanguage)!=='ja')return boundary;
   const earlier=retained?.earliestBefore(boundary?.startMs??Infinity,this.adapter.position);
   if(!earlier)return boundary;
   // The later window has already stopped capturing. Return the earliest
   // heard line for ordinary replay; never seek forward or keep decoder/speaker
   // state from media later than this newly restored practice endpoint.
   this.lastBoundaryEnd=earlier.endMs;this.turnContext=undefined;this.resumePosition=earlier.startMs;
   this.original.discardAfter(earlier.endMs);
   this.printedHints=this.printedHints.filter(turn=>turn.endMs<=earlier.endMs);
   if(earlier.reference){this.printedHints.push(earlier);if(this.printedHints.length>12)this.printedHints.shift();}
   console.debug('[声格印字补回]',JSON.stringify({version:1,startMs:Math.round(earlier.startMs),endMs:Math.round(earlier.endMs),laterStartMs:boundary?.startMs,position:Math.round(this.adapter.position)}));
   return {...earlier,language:'ja'};
  };
  const detect=async():Promise<LiveBoundary|undefined>=>{
   while(true){try{return recoverPrinted(await this.detectWindow(signal,onPhase,rangeEndMs,retained));}catch(error){
    if(error instanceof NonDialogue){const recovered=recoverPrinted();if(recovered)return recovered;throw error;}
    forget();
    if(!(error instanceof ResumeRecognition))throw error;
    signal.throwIfAborted();if(this.disposed||document.hidden)throw new DOMException('已暂停','AbortError');
    if(++restarts>5)throw new Error('播放器持续跳转，已暂停。稳定后可点击“重试识别”。');
    onPhase?.('reconnecting');await waitForStableMedia(this.adapter.video,signal);
    signal.throwIfAborted();if(document.hidden||this.disposed)throw new DOMException('已暂停','AbortError');
    await this.adapter.seek(error.rewindTo);
   }}
  };
  try{return await findNextDialogue({signal,position:()=>this.adapter.position,duration:()=>rangeEndMs??this.adapter.duration,seek:ms=>this.adapter.seek(ms),detect,searching:()=>onPhase?.('searching')});}
  finally{for(const event of events)this.adapter.video.removeEventListener(event,forget);signal.removeEventListener('abort',forget);forget();}
 }
 private async detectWindow(signal:AbortSignal,onPhase?:(phase:SearchPhase)=>void,rangeEndMs?:number,retained?:UnconfirmedVisualTurns):Promise<LiveBoundary|undefined>{
  const retentionEpoch=retained?.epoch;
  if(signal.aborted||this.disposed)throw new DOMException('已暂停','AbortError');
  // Preparation must not let the video run past the dialogue the user chose.
  this.adapter.pause();
  const vad=await this.model.catch(()=>{throw new Error('即时分句模型未能加载。更新后请重新加载声格扩展并刷新视频页。');});if(signal.aborted||this.disposed)throw new DOMException('已暂停','AbortError');
  if(rangeEndMs!==undefined)await prepareRecognition(this.transport,signal,message=>{this.preparationStatus=message;onPhase?.('preparing');});if(signal.aborted||this.disposed)throw new DOMException('已暂停','AbortError');
  const video=this.adapter.video;const origin=this.adapter.position;const trace=new RecognitionTrace(origin);this.resumePosition=origin;let active=false,lastTime=this.adapter.position,lastWall=performance.now();
  return new Promise((resolve,reject)=>{
   let starting:Promise<void>|undefined,bufferingTask:Promise<void>|undefined,bufferAbort:AbortController|undefined;
   let settled=false,closing=false,ending=false,ignoreTurnsBefore=origin,recoveries=0,reviewing=false,reviewEnd=origin,reviewHeld=false,resumingReview=false,heldPosition=origin;let tracker:StreamingTurns;let sentences:StreamingSentences;const pending=new PendingTurns(),reviewedSpeech=new ReviewedSpeech();
   const pauseBoundary=new SpeechBoundary(origin,640);
   const visual=rangeEndMs===undefined && this.adapter.videoKey?.startsWith('bilibili:') &&
    (!this.selectedLanguage || this.selectedLanguage==='ja') && typeof document.createElement==='function' ? new VisualTurns(origin) : undefined;
   let visualFrame=0, sampleTime=-Infinity, checkingVisual=false, checkingVisualTurn:VisualTurn|undefined, nextCheck=origin, visualResult:VisualTurn|undefined;
   let deferredAudio:{boundary:LiveBoundary;verified?:Caption;printedStartMs?:number}|undefined;
   let fallbackTimer:ReturnType<typeof setTimeout>|undefined;
   let independentBoundary=false;
   const useVisual=()=>this.selectedLanguage==='ja' || languageCode(this.language)==='ja';
   // A check of an earlier or overlapping line can still identify dialogue
   // before this boundary. A separate later line cannot postpone it.
   const relevantVisualCheck=(boundary:LiveBoundary)=>checkingVisualTurn!==undefined&&checkingVisualTurn.startMs<boundary.endMs;
   const releaseCheckedAudio=()=>{
    const deferred=deferredAudio;
    if(!deferred||settled||signal.aborted||!active||!this.adapter.valid||this.adapter.ad||video.seeking||video.paused||document.hidden)return;
    if(relevantVisualCheck(deferred.boundary)||visual?.openLine(deferred.boundary.startMs,deferred.boundary.endMs,this.adapter.position))return;
    finish(deferred.boundary,undefined,deferred.verified,true);
   };
   const acceptVisual=(turn:VisualTurn,exact=false)=>{
    turn=exact?turn:visual?.earliestSpokenThrough(turn)??turn;
    // An acoustic boundary for this exact line can extend past the last
    // printed frame. Keep that already-heard tail for the replay.
    const acoustic=deferredAudio?.boundary;
    if(acoustic && deferredAudio?.printedStartMs===turn.startMs && acoustic.endMs>=turn.startMs && acoustic.startMs<=turn.endMs){
     turn={...turn,startMs:Math.min(turn.startMs,acoustic.startMs),endMs:Math.max(turn.endMs,acoustic.endMs)};
    }
    visualResult=turn;trace.visual('accepted');
    trace.decision('printed-dialogue',turn,this.adapter.position);
    finish({startMs:turn.startMs,endMs:turn.endMs,text:turn.text,confidence:turn.confidence,language:'ja'});
   };
   const sampleVisual=(position:number)=>{
    if(this.language&&!useVisual())retained?.clear();
    if(!visual || !active || this.visualBusy || video.paused || video.seeking || position-sampleTime<155)return;
    sampleTime=position;this.visualBusy=true;
    const reader=this.visualReader??=new VisualCaptionReader();
    let observed=false;
    void reader.read(video,this.englishRequested).then(read=>{
     if(settled||signal.aborted||!active||!this.adapter.valid||video.seeking||Math.abs(this.adapter.position-position)>650)return;
     observed=true;
     if(read && read.confidence>=.93)trace.visual('reads');
     const turn=visual.observe(position,read,true);
     if(turn)trace.visual('lines');
     const current=useVisual()?visual.preview(position):undefined;
     this.preview=current?{...current,language:'ja'}:undefined;
     if(!turn)return;
     if(!this.language && visual.hasVoice(turn.startMs,turn.endMs) && matchesPriorPrint(turn,this.printedHistory)){
      // Keep checking this soundtrack independently. Another audio track
      // invalidates this historical hint even if the picture is unchanged.
      const verification=sentences.audioFor(turn);
      this.original.confirmFromPrintedSpeech(false);
      if(verification.length>=6400)void this.captions.transcribe(verification,undefined,6000,false).then(result=>{
       if(!this.disposed && result)this.original.recheckPrintedLanguage(result);
      });
     }
     if(useVisual() && visual.hasVoice(turn.startMs,turn.endMs)){acceptVisual(turn);return;}
     if(checkingVisual){trace.skipVisualCheck(turn,this.adapter.position,'busy');return;}
     if(position<nextCheck){trace.skipVisualCheck(turn,this.adapter.position,'cooldown');return;}
     if(this.language && languageCode(this.language)!=='ja'){trace.skipVisualCheck(turn,this.adapter.position,'non-japanese-source');return;}
     const audio=sentences.audioFor(turn);
     if(audio.length<6400){trace.skipVisualCheck(turn,this.adapter.position,'insufficient-samples');return;}
     if(!audio.some(sample=>Math.abs(sample)>.009)){trace.skipVisualCheck(turn,this.adapter.position,'low-peak-audio');return;}
     checkingVisual=true;checkingVisualTurn=turn;nextCheck=position+3000;
     trace.visual('audioChecks');
     const check=trace.startVisualCheck(turn,this.adapter.position,audio.length/16);
     void this.captions.transcribe(audio,undefined,6500).then(result=>{
      if(settled||signal.aborted||!this.adapter.valid){trace.finishVisualCheck(check,'invalid-window');return;}
      const matched=sameJapaneseSpeech(turn.text,result);
      trace.finishVisualCheck(check,visualCheckOutcome(result,matched));
      if(!matched)return;
      this.original.confirmFromPrintedSpeech();acceptVisual(turn);
     },error=>{trace.finishVisualCheck(check,'request-rejected');throw error;}).finally(()=>{checkingVisual=false;checkingVisualTurn=undefined;if(!settled){releaseCheckedAudio();processTurns();finishEmptyWindow();}});
    }).finally(()=>{this.visualBusy=false;if(observed)releaseCheckedAudio();});
   };
   const watchFrame=(_now:number,metadata:VideoFrameCallbackMetadata)=>{
    if(settled)return;
    visualFrame=video.requestVideoFrameCallback(watchFrame);
    sampleVisual(metadata.mediaTime*1000);
   };
   if(visual && typeof video.requestVideoFrameCallback==='function')visualFrame=video.requestVideoFrameCallback(watchFrame);
   const acceptFast=(boundary:{startMs:number;endMs:number},reason?:PendingTurn['reason'])=>{
    independentBoundary=reason==='speaker-change';
    trace.decision('acoustic-accepted',boundary,this.adapter.position);
    closing=true;finish(boundary);
   };
   // One decoder cannot keep up with arbitrarily many uncertain turns. Once a
   // second reviewable candidate is waiting, preserve its audio and hold the
   // picture instead of letting a FIFO lag tens of seconds behind playback.
   // No candidate is discarded and resuming never seeks past unheard video.
   let activeReviewTurn:PendingTurn|undefined;
   const holdForReview=()=>{
    const next=activeReviewTurn && pending.firstOtherAudio(activeReviewTurn,candidate=>visual?.sharesReviewHold(activeReviewTurn!,candidate)??false);
    if(checkingVisual || visual?.recentLine(this.adapter.position))return;
    if(deferredAudio||reviewHeld||ending||bufferingTask||!reviewing||!next||!sentences.reviewAudio(next,ending))return;
    reviewHeld=true;heldPosition=this.adapter.position;this.holdingCapture=true;
    trace.decision('review-hold',next,this.adapter.position);
    this.adapter.pause();onPhase?.('waiting-review');
   };
   const resumeAfterReview=(needsMoreAudio=false)=>{
    if(!reviewHeld||resumingReview||reviewing||pending.first&&!needsMoreAudio||ending||settled||closing)return;
    resumingReview=true;
    void this.drainFrames().then(async()=>{
     if(settled||closing||signal.aborted)return;
     // A turn-model inference may have completed while old frames drained.
     if(pending.first&&!needsMoreAudio){processTurns();return;}
     await this.adapter.play();
     if(settled||closing||signal.aborted){this.adapter.pause();return;}
     reviewHeld=false;this.holdingCapture=false;lastTime=this.adapter.position;lastWall=performance.now();
     this.frame=(p,frame,time,wall)=>consume(p,frame,time,wall);
     trace.decision('review-resume',{startMs:lastTime,endMs:lastTime},lastTime);
     onPhase?.('listening');
    }).catch(error=>{if(!settled)finish(undefined,error);}).finally(()=>{resumingReview=false;if(reviewHeld&&!reviewing&&!pending.first&&!settled)resumeAfterReview();});
   };
   const processTurns=()=>{
    if(this.language&&!useVisual())retained?.clear();
    if(settled||closing||rangeEndMs!==undefined)return;
    if(checkingVisual || deferredAudio)return;
    if(reviewing){holdForReview();return;}
    pending.discardThrough(ignoreTurnsBefore);
    const b=pending.first;if(!b){resumeAfterReview();return;}
    if(!ending && b.reason!=='speaker-change' && (!this.language || useVisual()) && visual?.activeAt(b.startMs,this.adapter.position)){
     // The printed line can only close on a subsequent playing frame.
     // An acoustic backlog hold must release playback while awaiting it.
     resumeAfterReview(true);return;
    }
    const boundary=sentences.acousticBoundary(b,ending);
    if(typeof __SHENGGE_QA__!=='undefined'&&__SHENGGE_QA__)console.debug('[声格声学边界]',JSON.stringify({candidate:b,accepted:boundary,position:this.adapter.position}));
    if(!boundary){
     const audio=sentences.reviewAudio(b,ending);if(!audio){
      // Allow fresh evidence to arrive, but do not let an unsupported old sound
      // hide every later candidate until the ten-second window rolls past it.
      if(ending||this.adapter.position-b.endMs>=2000){trace.decision('no-review-evidence',b,this.adapter.position);pending.shift();pending.discardReviewed(b,b.endMs);processTurns();}
      else resumeAfterReview(true);
      return;
     }
     const evidence=sentences.reviewEvidence(b);
     if(reviewedSpeech.has(b,evidence,this.language)){
      trace.decision('review-unchanged',b,this.adapter.position);pending.shift();processTurns();return;
     }
     trace.decision('review-start',b,this.adapter.position);pending.shift();
     activeReviewTurn=b;reviewEnd=b.endMs;reviewing=true;onPhase?.(reviewHeld?'waiting-review':'recovering');
     const language=this.language,deadline=Date.now()+8000;
     void this.captions.transcribe(audio.pcm,language,8000).then(async result=>{
      if(settled||signal.aborted)return;
      this.original.observeTranscript(result,{start:0,end:audio.pcm.length/16,audioEnd:audio.pcm.length/16,mediaStartMs:audio.toMedia(0),rate:video.playbackRate});
      const printed=b.reason!=='speaker-change'?visual?.matching(b.startMs,b.endMs):undefined;
      if(printed && (useVisual() || sameJapaneseSpeech(printed.text,result))){
       this.original.confirmFromPrintedSpeech(sameJapaneseSpeech(printed.text,result));if(!visual?.recentLine(this.adapter.position)){acceptVisual(printed);return;}
      }
      const agreed=b.reason!=='speaker-change'?visual?.forTranscript(result,audio.toMedia):undefined;
      if(agreed){this.original.confirmFromPrintedSpeech();if(!visual?.recentLine(this.adapter.position)){acceptVisual(agreed);return;}}
      let reviewed=reviewedTurn(result,audio.candidate,audio.pcm.length/16,audio.ended);
      if(reviewed&&!language){
       const shift=128,remaining=deadline-Date.now();
       if(reviewed.startMs<shift||remaining<500)reviewed=undefined;
       else {
        const check=await this.captions.transcribe(audio.pcm.slice(shift*16),undefined,remaining);
        if(settled||signal.aborted)return;
        this.original.observeTranscript(check,{start:0,end:audio.pcm.length/16-shift,audioEnd:audio.pcm.length/16-shift,mediaStartMs:audio.toMedia(shift),rate:video.playbackRate});
        const second=reviewedTurn(check,{...audio.candidate,startMs:audio.candidate.startMs-shift,endMs:audio.candidate.endMs-shift},audio.pcm.length/16-shift,audio.ended);
        reviewed=agreeingReview(reviewed,second,shift);
       }
      }
      reviewing=false;
      trace.decision(reviewed?'review-accepted':'review-rejected',b,this.adapter.position);
      if(typeof __SHENGGE_QA__!=='undefined'&&__SHENGGE_QA__)console.debug('[声格短复核]',JSON.stringify({candidate:audio.candidate,origin:audio.toMedia(0),duration:audio.pcm.length/16,result,reviewed}));
      if(reviewed){const boundary={...reviewed,startMs:audio.toMedia(reviewed.startMs),endMs:audio.toMedia(reviewed.endMs)};
       const caption=captionFromReview(result,dialogueLeadIn(boundary,origin),{durationMs:audio.pcm.length/16,toMedia:audio.toMedia},this.language);
       independentBoundary=b.reason==='speaker-change';finish(boundary,undefined,caption);return;}
      reviewedSpeech.remember(b,evidence,result,language);
      pending.discardReviewed(b,result?audio.toMedia(audio.pcm.length/16):b.endMs+400);
      processTurns();
      // A drained recognition window is not the end of the video. In
      // particular, a review started by the 45-second flush can finish later
      // than closeWindow. Use the same continuation path in both cases.
      if(ending&&!settled&&!reviewing)finishEmptyWindow();
      else if(!settled&&!reviewing&&!reviewHeld)onPhase?.('listening');
     }).catch(error=>{if(!settled)finish(undefined,error);});
     return;
    }
    acceptFast(boundary,b.reason);
   };
   const closeTurn=(b:PendingTurn)=>{
    if(settled||closing||rangeEndMs!==undefined||b.endMs<=origin)return;
    if(deferredAudio&&b.reason==='speaker-change'&&sentences.acousticBoundary(b,ending)){
     // A shared printed row cannot erase an independently confirmed speaker
     // transition. Submit the EARLIER interval first; the later audio remains
     // on the normal forward timeline for the next search after replay.
     independentBoundary=true;finish(deferredAudio.boundary,undefined,deferredAudio.verified,true);return;
    }
    // A failed text review suppresses another decode, not fresh acoustic
    // evidence. Quiet speech may become corroborated only in later windows.
    // Track completed reviews by interval, not a global endpoint. Starting
    // a slow review must not discard independent adjacent or nested replies.
    if(b.endMs<=ignoreTurnsBefore||pending.wasReviewed(b)){
     // Reconsider while this is still a recent reply. A much later window
     // must not resurrect an old rejected sound and rewind several seconds.
     const fast=this.adapter.position-b.endMs<=2500?sentences.acousticBoundary(b,ending):undefined;
     if(typeof __SHENGGE_QA__!=='undefined'&&__SHENGGE_QA__)console.debug('[声格复核后声学]',JSON.stringify({candidate:b,accepted:fast,position:this.adapter.position}));
     if(fast){this.captions.cancelReview();acceptFast(fast,b.reason);}return;
    }
    if(reviewing&&b.startMs<=reviewEnd+320&&b.endMs>=reviewEnd-400){const fast=sentences.acousticBoundary(b,ending);if(fast){this.captions.cancelReview();acceptFast(fast,b.reason);return;}}
    pending.add(b);queueMicrotask(processTurns);
   };
   const finish=(boundary?:LiveBoundary,error?:Error,verified?:Caption,force=false)=>{
    if(settled)return;
    if(error instanceof NonDialogue&&visual){
     if(this.language&&!useVisual())retained?.clear();
     else retained?.remember(visual.spokenLines(),this.adapter.position,retentionEpoch);
    }
    if(!force && !independentBoundary && boundary && !error && !visualResult && !ending && !video.paused && visual &&
       (relevantVisualCheck(boundary) || visual.openLine(boundary.startMs,boundary.endMs,this.adapter.position))){
     if(!deferredAudio){
      deferredAudio={boundary,verified,printedStartMs:(visual.openLine(boundary.startMs,boundary.endMs,this.adapter.position)??visual.matching(boundary.startMs,boundary.endMs,true))?.startMs};
      const release=()=>{
       const fallback=deferredAudio;
       // Four elapsed wall seconds do not close a line that is still being
       // observed. Recheck its existing bounded freshness; no extra decode,
       // seek or confidence relaxation is involved.
       if(fallback&&!settled&&visual.openLine(fallback.boundary.startMs,fallback.boundary.endMs,this.adapter.position)){
        fallbackTimer=setTimeout(release,155);return;
       }
       if(fallback && !settled)finish(fallback.boundary,undefined,fallback.verified,true);
      };
      fallbackTimer=setTimeout(release,4000);
     }
     closing=false;return;
    }
    clearTimeout(fallbackTimer);settled=true;if(visualFrame)video.cancelVideoFrameCallback(visualFrame);this.preview=undefined;this.holdingCapture=false;if(boundary&&!error&&rangeEndMs===undefined&&!visualResult){
    const printed=!independentBoundary?visual?.completeMatching(boundary.startMs,boundary.endMs):undefined;
    if(printed && useVisual()){visualResult=printed;boundary={...boundary,text:printed.text,language:'ja',confidence:printed.confidence};}
   }
   if(boundary&&!error&&rangeEndMs===undefined&&!visualResult){const {text,language,confidence,...interval}=dialogueLeadIn(boundary,origin);const {pcm,...context}=sentences.captionAudio(interval);const printed=!independentBoundary?visual?.completeMatching(boundary.startMs,boundary.endMs):undefined;
    const decoded=this.caption(pcm,verified,{...context,rate:video.playbackRate,continuation:this.lastBoundaryEnd!==undefined&&Math.abs(origin-this.lastBoundaryEnd)<=150,printed});
    boundary={...interval,caption:printed?decoded.then(caption=>{
     if(!caption || this.disposed || !sameJapaneseSpeech(printed.text,{language:caption.language,segments:[{...caption,startMs:0,endMs:pcm.length/16}]}))return caption;
     this.original.confirmFromPrintedSpeech();
     return {text:printed.text,confidence:printed.confidence,language:'ja'};
    }):decoded};}else if(!visualResult&&boundary?.text&&(!this.language||languageCode(boundary.language)!==languageCode(this.language))){boundary={...boundary,text:undefined,language:undefined,caption:this.caption(sentences.audioFor(boundary))};}if(visualResult?.reference && boundary && !error){this.printedHints.push(visualResult);if(this.printedHints.length>12)this.printedHints.shift();}
   if(boundary&&!error){this.lastBoundaryEnd=Math.min(this.adapter.duration,boundary.endMs);this.turnContext=tracker.contextThrough(this.lastBoundaryEnd);}bufferAbort?.abort();trace.finish(this.adapter.position,boundary,error);if(reviewing||checkingVisual)this.captions.cancelReview();tracker.stop();sentences.stop();this.frame=undefined;this.stop=undefined;signal.removeEventListener('abort',abort);for(const [event,fn]of listeners)video.removeEventListener(event,fn);this.adapter.mediaEnd.removeEventListener('ended',ended);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);clearTimeout(timeout);this.adapter.pause();
    // pause() resets the recurrent model synchronously. Reset only after the
    // old inference finishes, otherwise it can write stale state after reset.
    // A cancelled start must also finish before its stream is disconnected.
    this.cleanup=Promise.resolve(starting).catch(()=>{}).then(()=>this.drainFrames()).then(()=>vad.pause());
    void this.cleanup.then(()=>error?reject(error):resolve(boundary?{...boundary,startMs:Math.round(Math.max(origin,boundary.startMs)),endMs:Math.round(Math.min(this.adapter.duration,boundary.endMs))}:undefined),reject);
   };
   // Process after all candidates from this inference have been enqueued.
   tracker=new StreamingTurns(this.turns,origin,video.playbackRate,closeTurn,()=>finish(undefined,new Error('说话人检测失败，已暂停；没有把不确定的区间当作一句保存。')),start=>sentences.markSpeechStart(start),(frames,focused,window)=>{trace.observe(frames,this.adapter.position,focused);
    if(visual&&!focused&&window&&(!this.language||useVisual()))visual.corroborateSpeakerWindow(frames.map(f=>({...f,atMs:origin+f.atMs*video.playbackRate})),window,this.adapter.position);
    if(visual && !focused)for(const f of frames.slice(-18))if(f.speaker>=0 && f.confidence>=.72)visual.hear(origin+f.atMs*video.playbackRate,1);
    if(visual&&!focused&&window&&!settled&&!closing&&!ending&&!deferredAudio&&!signal.aborted&&
       this.adapter.valid&&!this.adapter.ad&&!video.seeking&&(!video.paused||reviewHeld)&&!document.hidden&&
       languageCode(this.language)==='ja'&&languageCode(this.original.audioConfirmedLanguage)==='ja'){
     const printed=visual.reconsiderSpoken(frames.map(f=>({...f,atMs:origin+f.atMs*video.playbackRate})),window,this.adapter.position);
     if(printed){acceptVisual(printed,true);return;}
    }
    sentences.observeSpeech(frames,focused);queueMicrotask(processTurns);},this.turnContext);
   sentences=new StreamingSentences(origin,s=>{this.observeLanguage(s.text,s.language);finish({startMs:s.startMs,endMs:s.endMs,text:s.text,language:s.language,confidence:s.confidence});},e=>{
    if(e instanceof UncertainDialogue&&rangeEndMs===undefined&&!video.ended&&this.adapter.position<this.adapter.duration-100&&recoveries++<3){
     ignoreTurnsBefore=this.adapter.position+700;sentences.reopen();closing=false;this.frame=undefined;onPhase?.('recovering');
     void this.adapter.play().then(()=>{if(settled)return;active=true;lastTime=this.adapter.position;lastWall=performance.now();this.frame=(p,frame,time,wall)=>consume(p,frame,time,wall);}).catch(error=>finish(undefined,error));
    }else finish(undefined,e);
   // Decode the closed candidate once, rather than queuing incomplete, growing
   // windows behind a slow GPU job. Word alignment still validates the boundary.
   },this.transport,this.language,true,this.lastBoundaryEnd!==undefined&&Math.abs(origin-this.lastBoundaryEnd)<=150);
   const abort=()=>finish(undefined,new DOMException('已暂停','AbortError'));
   // While automatic discovery owns playback, a native seek must not commit
   // an unexamined gap. Resume the unfinished window, including after seeked.
   // Seeking while practice is paused still chooses a new starting position.
   const restart=(reason:'seek'|'buffer'|'rate'|'capture')=>{if(active||closing)finish(undefined,new ResumeRecognition(origin,reason));};
   let windowEnd=origin,windowDrained=false;
   const finishEmptyWindow=()=>{
    // A closed playback window can still own a pending check of a line that
    // was already heard. Both that check and the final turn-model flush must
    // finish before the window can be declared empty.
    if(ending&&windowDrained&&!settled&&!closing&&!reviewing&&!checkingVisual&&!deferredAudio&&!pending.first)
     finish(undefined,new NonDialogue(windowEnd,windowEnd));
   };
   const closeWindow=(endMs:number)=>{if(ending||settled)return;if(deferredAudio){finish(deferredAudio.boundary,undefined,deferredAudio.verified,true);return;}windowEnd=endMs;ending=true;active=false;this.frame=undefined;this.adapter.pause();void tracker.finish().then(()=>{if(settled||closing)return;if(rangeEndMs!==undefined){closing=true;onPhase?.('confirming');sentences.finish({startMs:origin,endMs});return;}const tail=pauseBoundary.finish(endMs);if(tail)closeTurn({...tail,reason:'turn-end'});windowDrained=true;processTurns();finishEmptyWindow();}).catch(e=>finish(undefined,e));};
   const ended=()=>{endedCaptureSources.add(video);closeWindow(rangeEndMs??this.adapter.duration);};
   // YouTube can buffer on its final frame before firing ended. Buffering is
   // not a manual pause: keep listening when data resumes, or close at EOF.
   const buffering=()=>{
    if(!active||bufferingTask||reviewHeld)return;
    if(this.adapter.duration-this.adapter.position<=200){ended();return;}
    // Buffering does not itself invalidate the audio already collected. A
    // rewind here repeatedly hits the same native timestamp gap (8:21 on B站).
    // Stop accepting frames while waiting; preserve the unfinished sentence.
    this.frame=undefined;bufferAbort=new AbortController();onPhase?.('reconnecting');
    trace.decision('buffer-wait',{startMs:lastTime,endMs:this.adapter.position},this.adapter.position);
    bufferingTask=waitForStableMedia(video,bufferAbort.signal).then(async()=>{
     await this.drainFrames();if(settled||signal.aborted)return;
     if(video.paused){abort();return;}
     const time=this.adapter.position,now=performance.now();
     if(captureDiscontinuity(time,lastTime,now,lastWall,video.playbackRate)&&!smallForwardCorrection(time,lastTime,now,lastWall,video.playbackRate)){restart('buffer');return;}
     lastTime=time;lastWall=now;this.frame=(p,frame,time,wall)=>consume(p,frame,time,wall);
     onPhase?.(reviewing?'recovering':'listening');
    }).catch(error=>{if(!settled)finish(undefined,error);}).finally(()=>{bufferingTask=undefined;bufferAbort=undefined;});
   };
   const hidden=()=>{if(document.hidden)abort();};const blur=()=>abort();
   const seeking=()=>{if(!(active||closing)||this.adapter.seekingControlled)return;
    if(reviewHeld){abort();return;}
    if(active&&smallForwardCorrection(this.adapter.position,lastTime,performance.now(),lastWall,video.playbackRate)){
     this.adapter.rememberNativeGap(lastTime,this.adapter.position);
     trace.decision('clock-correction',{startMs:lastTime,endMs:this.adapter.position},this.adapter.position);
     // Do not advance lastTime here: older captured frames may still be in the
     // inference queue. Their ingress clocks must remain ordered.
     return;
    }
    restart('seek');
   };
   const listeners:[string,()=>void][]=[['pause',()=>{if(active&&video.paused&&!video.ended&&!reviewHeld)abort();}],['play',()=>{if(reviewHeld&&!resumingReview)abort();}],['waiting',buffering],['stalled',buffering],['seeking',seeking],['ratechange',()=>reviewHeld?abort():restart('rate')],['error',()=>finish(undefined,new Error('视频加载失败，请等待原站恢复后重试识别。'))]];
   const expire=()=>{if(closing||reviewing||reviewHeld||resumingReview||bufferingTask)timeout=setTimeout(expire,1000);else closeWindow(this.adapter.position);};let timeout=setTimeout(expire,45000);
   this.stop=abort;signal.addEventListener('abort',abort,{once:true});for(const [event,fn]of listeners)video.addEventListener(event,fn);this.adapter.mediaEnd.addEventListener('ended',ended);document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);
   const consume=(p:number,frame:Float32Array,time:number,now:number)=>{if(!active||settled||video.paused&&!(reviewHeld&&time<=heldPosition))return;if(document.hidden){abort();return;}if(!this.adapter.valid||this.adapter.ad){finish(undefined,new Error('视频已变化或正在播放广告，请回到正片后重新连接。'));return;}if(captureDiscontinuity(time,lastTime,now,lastWall,video.playbackRate)&&!smallForwardCorrection(time,lastTime,now,lastWall,video.playbackRate)){restart('capture');return;}lastTime=time;lastWall=now;trace.frame(p,frame,time);tracker.push(frame,time);sentences.push(frame,time,p);visual?.hear(time,p);if(visual && !visualFrame)sampleVisual(this.adapter.position);
    const candidate=pauseBoundary.push(time,p);
    if(candidate&&rangeEndMs===undefined&&candidate.endMs>ignoreTurnsBefore){
     closeTurn({...candidate,reason:'turn-end'});
     // Speaker evidence may refine the onset, but need not block pausing or ASR.
     void tracker.flush().catch(e=>finish(undefined,e));
    }
    if(rangeEndMs!==undefined&&time>=rangeEndMs)ended();};
   starting=vad.start().then(async()=>{
    if(settled)return;await this.adapter.play();if(settled){this.adapter.pause();return;}
    if(endedCaptureSources.has(video)){
     // Chrome may return a live but permanently silent capture track when a
     // completed media element is captured while paused. Reacquire only after
     // playback has resumed, then restore the requested position before any
     // recognition frames are accepted. Cancellation never restarts playback.
     await vad.pause();if(settled)return;
     await vad.start();if(settled){this.adapter.pause();return;}
     await this.adapter.seek(origin);if(settled)return;
     await this.adapter.play();if(settled){this.adapter.pause();return;}
     endedCaptureSources.delete(video);
    }
    onPhase?.('listening');active=true;lastTime=this.adapter.position;lastWall=performance.now();this.frame=(p,frame,time,wall)=>consume(p,frame,time,wall);
   });
   void starting.catch(e=>finish(undefined,e));
  });
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.visualReader?.dispose();this.original.dispose();this.captions.dispose();this.stop?.();this.turns.dispose();this.stream?.getTracks().forEach(t=>t.stop());void this.model.then(async v=>{await this.cleanup.catch(()=>{});await v.destroy();}).catch(()=>{}).finally(()=>{if(this.audioContext.state!=='closed')return this.audioContext.close();}).catch(()=>{});}
}
