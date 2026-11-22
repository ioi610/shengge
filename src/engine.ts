import {promptEnd} from './training-flow';
import {AppError, Clip, Mode, State, complete, gapMs, uid, message, shadowSettings} from './domain';
import {Client} from './client';
import {Request} from './storage';
import {VideoAdapter} from './player';
export class Engine extends EventTarget {
 prepareRepeat?:()=>boolean|Promise<boolean>;
 discovering=false;state:State='READY';mode:Mode='listen';error='';reconnectRequired=false;current=0;questionIndex=0;
 private lastUserSeek=-Infinity;
 private retriedLateAttempt?:string;
 private buffering=false;private token=0;private attempt?:string;private lastMedia=0;private lastWall=0;private pauseAt=0;private pauseFrom:State='READY';private gapUntil=0;private gapLeft:number|null=0;private nextAfterGap:()=>void=()=>{};private expectedPause=false;private purpose:'repeat'|'prompt'|'answer'|'preview'='repeat';private playbackStart=0;private playbackEnd=0;private lastTick=0;private pending?:{request:Request;after:()=>void|Promise<void>};private frame=0;private renewal:ReturnType<typeof setInterval>;private leaseDeadline=0;private disposed=false;practiceIds?:Set<string>;
 private recoveringLease=false;private retrying=false;private continuation?:()=>void|Promise<void>;
 private cleanup:(()=>void)[]=[];
 constructor(readonly adapter:VideoAdapter,readonly client:Client,private shadowOnly=false){super();this.current=client.clip?.current??0;this.mode=client.clip?.mode??'listen';this.practiceIds=client.clip?.practiceIds?new Set(client.clip.practiceIds):undefined;this.leaseDeadline=client.owner?.expiresAt??0;const listen=(target:EventTarget,event:string,fn:EventListener)=>{target.addEventListener(event,fn);this.cleanup.push(()=>target.removeEventListener(event,fn));};
  const seekGesture=(event:Event)=>{
   if(!event.isTrusted)return;
   if(event.type==='keydown'){
    if(!['ArrowLeft','ArrowRight','Home','End','j','l','J','L','0','1','2','3','4','5','6','7','8','9'].includes((event as KeyboardEvent).key))return;
   }else if(!(event.target instanceof Element) || !event.target.closest('.bpx-player-progress,.bpx-player-progress-wrap,.ytp-progress-bar,[role="slider"][aria-valuetext*=":"]'))return;
   this.lastUserSeek=performance.now();
  };
  for(const event of ['pointerdown','pointerup','keydown'])listen(document,event,seekGesture);
  listen(adapter.video,'seeking',()=>{if(!adapter.seekingControlled&&['PLAYING','PAUSED'].includes(this.state)&&!this.acceptNativeGap(adapter.position,performance.now()))this.interrupt('播放位置改变，本遍将从句首重新开始。');});
  listen(adapter.video,'waiting',()=>{if(this.state==='PLAYING')this.buffering=true;});
  listen(adapter.video,'stalled',()=>{if(this.state==='PLAYING'&&adapter.video.readyState<3)this.buffering=true;});
  listen(adapter.video,'pause',()=>{if(this.state==='PLAYING'&&!this.expectedPause&&adapter.video.paused&&!adapter.video.ended)this.pause();});
  listen(adapter.video,'ratechange',()=>{if(this.state==='PLAYING')this.interrupt('速度已改变，本遍将从句首重新开始。');});
  listen(adapter.video,'error',()=>this.interrupt('视频无法播放，请确认来源可访问。'));
  listen(window,'blur',()=>this.pause());listen(document,'visibilitychange',()=>{if(document.hidden)this.pause();});
  listen(adapter.video,'play',()=>{if(!this.discovering&&this.state!=='PLAYING'&&this.state!=='SEEKING')this.stopMedia();});
  this.renewal=setInterval(()=>this.renew(),5000);this.tick();
 }
 get clip():Clip{return this.client.clip!;}
 get segment(){return this.clip.segments[this.current];}
 get progress(){return this.clip.progress[this.segment.id];}
 get question(){return this.clip.questions[this.questionIndex];}
 get running(){return ['PLAYING','SEEKING','GAP','COMMITTING'].includes(this.state);}
 private emit(){this.adapter.setCueHidden?.(this.mode==='cue'&&this.purpose!=='answer');this.dispatchEvent(new Event('change'));}
 private set(s:State){this.state=s;this.emit();}
 private stopMedia(){this.expectedPause=true;this.adapter.pause();this.expectedPause=false;}
 private async renew(){if(!this.client.owner||this.disposed)return false;try{const owner=await this.client.renew();if(this.disposed||!owner)return false;this.leaseDeadline=owner.expiresAt;return true;}catch(e){if(!this.disposed)this.interrupt(message(e),true);return false;}}
 private async recoverLease(){
  if(this.recoveringLease||this.disposed)return;
  this.recoveringLease=true;
  const before=this.state;
  if(before!=='COMMITTING')this.pause();
  // Do not count an attempt spanning suspension; restart its original range.
  const token=this.token,start=this.playbackStart,end=this.playbackEnd,purpose=this.purpose;
  try{
   if(!await this.renew()||this.disposed||token!==this.token||document.hidden)return;
   if(before==='COMMITTING')return;
   if(!this.adapter.valid||this.adapter.ad)return;
   if(before==='GAP')await this.resume();
   else {this.attempt=purpose==='repeat'?uid():undefined;await this.playRange(start,end,purpose);}
  }finally{this.recoveringLease=false;}
 }
 private acceptNativeGap(media:number,now:number){
  if(this.state!=='PLAYING'||this.adapter.video.paused||now-this.lastWall<0||now-this.lastWall>1000||now-this.lastUserSeek<=1500||this.lastMedia<this.playbackStart||media>this.playbackEnd)return false;
  if(!this.adapter.isKnownNativeGap?.(this.lastMedia,media)){
   if(this.purpose==='repeat' && this.adapter.rememberShortReplayStart?.(this.lastMedia,media,this.playbackStart)){
    // A demuxer jump immediately after seeking did not play the sentence.
    // Retry from before it so the native decoder can deliver its first frames.
    this.stopMedia();void this.playRange(this.playbackStart,this.playbackEnd,'repeat');return true;
   }
   // A restored record may no longer have its discovery-time observation.
   // This attempt still interrupts. A retry can then recognize the same real
   // buffered hole instead of making the saved sentence impossible to finish.
   this.adapter.rememberNativeGap?.(this.lastMedia,media);
   return false;
  }
  console.debug('[声格原站缓冲跳变]',JSON.stringify({from:Math.round(this.lastMedia),to:Math.round(media)}));
  this.lastMedia=media;this.lastWall=now;return true;
 }
 private retryDelayedRepeat(media:number,now:number,wall:number,moved:number){
  // A busy foreground main thread can miss several frames while native media
  // keeps playing. Do not credit that unobserved traversal, or strand it behind
  // the jump guard: rewind this attempt once if both clocks still agree.
  // Keep this short and bounded; suspension and repeated stalls need the normal
  // interruption/recovery path, and an intentional pause/seek must never autoplay.
  const video=this.adapter.video;
  if(this.purpose!=='repeat'||!this.attempt||this.retriedLateAttempt===this.attempt||
     document.hidden||video.paused||video.seeking||video.readyState<3||
     now-this.lastUserSeek<=1500||wall<=0||wall>5000||
     this.lastMedia<this.playbackStart||this.lastMedia>=this.playbackEnd||
     moved<0||Math.abs(moved-wall*video.playbackRate)>100)return false;
  this.retriedLateAttempt=this.attempt;this.stopMedia();
  void this.playRange(this.playbackStart,this.playbackEnd,'repeat');return true;
 }
 private tick=()=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.tick);const now=performance.now();if(now-this.lastTick<16)return;this.lastTick=now;
  if(this.client.owner)this.leaseDeadline=this.client.owner.expiresAt;
  if(this.running&&this.adapter.valid&&!this.adapter.ad&&Date.now()>=this.leaseDeadline){void this.recoverLease();return;}
  if(this.running&&(!this.adapter.valid||this.adapter.ad||Date.now()>this.leaseDeadline)){this.interrupt(!this.adapter.valid?'视频已变化，请重新连接。':this.adapter.ad?'广告播放中，回到正片后继续。':'会话连接已失效，请重新连接。',!this.adapter.valid||Date.now()>this.leaseDeadline);return;}
  if(this.state==='GAP'&&this.gapLeft!==null&&now>=this.gapUntil){this.nextAfterGap();return;}
  if(this.state!=='PLAYING')return;
  // Browser buffering is temporary; preserve the attempt and let native media resume.
  if(this.buffering){this.lastWall=now;if(this.adapter.video.readyState<3&&!this.adapter.video.ended)return;this.buffering=false;}
  const media=this.adapter.position;const wall=now-this.lastWall;const moved=media-this.lastMedia;
  if(wall>15000){void this.recoverLease();return;}
  if((wall>1200||media>this.playbackEnd+300)&&this.retryDelayedRepeat(media,now,wall,moved))return;
  if(wall>1200||moved<-100||moved>Math.max(400,wall*this.adapter.video.playbackRate+250)){if(!this.acceptNativeGap(media,now)){this.interrupt('播放发生跳转，本遍未计数。');return;}}
  if(this.state!=='PLAYING')return;
  this.lastMedia=media;this.lastWall=now;
  if(media>=this.playbackEnd-8||this.adapter.video.ended){
   if(this.adapter.video.ended&&media<this.playbackEnd-150){this.interrupt('视频提前结束，本遍未计数。');return;}
   if(media>this.playbackEnd+300){
    this.interrupt('播放超出句子边界，本遍未计数。');return;
   }
   void this.boundary();
  }
 };
 async attach(){
  // Old review checkpoints resume safely without replaying the whole video.
  if(this.mode==='review')this.mode=this.clip.questions.length&&this.clip.questions.every(q=>q.rating)?'done':'listen';
  if(this.mode==='cue'){
   this.questionIndex=this.clip.questions.findIndex(q=>!q.rating);
   if(!this.adapter.cueSafe)this.mode='listen';
   else if(this.questionIndex<0)this.mode='done';
  }
  if(this.shadowOnly&&this.mode==='listen')this.mode='shadow';
  const settings=this.shadowOnly?shadowSettings(this.clip.settings):this.adapter.rates.includes(this.clip.settings.rate)?undefined:{...this.clip.settings,rate:this.adapter.rates.includes(this.adapter.video.playbackRate)?this.adapter.video.playbackRate:this.adapter.rates[0]};
  const token=++this.token;
  await this.persist('SAVE_CHECKPOINT',{current:this.current,mode:this.mode,...(settings?{settings}:{})},async()=>{
   if(this.disposed||token!==this.token)return;
   this.adapter.setRate(this.clip.settings.rate);
   const cue=this.mode==='cue'?this.clip.segments.find(s=>s.id===this.question.cueId):undefined;
   if(cue)this.purpose='prompt';
   this.set('SEEKING');await this.adapter.seek(cue?.startMs??this.segment.startMs);
   if(this.disposed||token!==this.token)return;
   // A refresh has not played this prompt. Wait for an explicit play action.
   this.set(this.mode==='done'?'PRACTICE_DONE':'READY');
  });
 }
 private async playRange(start:number,end:number,purpose:Engine['purpose'],resume=false){
  if(this.pending||this.disposed)return;
  const token=++this.token;this.error='';this.reconnectRequired=false;this.buffering=false;
  this.purpose=purpose;if(!resume)this.playbackStart=start;this.playbackEnd=end;this.set('SEEKING');
  try{
   if(Date.now()>=this.leaseDeadline&&!await this.renew())return;
   if(this.disposed||token!==this.token)return;
   if(!this.adapter.valid||this.adapter.ad){this.interrupt(this.adapter.ad?'广告播放中，回到正片后继续。':'视频已变化，请重新连接。',!this.adapter.valid);return;}
   if(this.shadowOnly)this.adapter.setRate(1);if(!resume)await this.adapter.seek(purpose==='repeat'?(this.adapter.replayDecodeStart?.(start,end)??start):start);if(token!==this.token)return;
   this.lastMedia=this.adapter.position;this.lastWall=performance.now();this.set('PLAYING');await this.adapter.play();
   if(token!==this.token&&(this.disposed||this.state!=='PLAYING'))this.stopMedia();
  }catch(e){if(token===this.token)this.interrupt(message(e));}
 }
 async start(){if(this.pending||this.disposed)return;this.continuation=undefined;if(this.mode==='cue'){await this.prompt();return;}if(this.mode==='done'){this.set('PRACTICE_DONE');return;}if(complete(this.progress)){this.set('PRACTICE_DONE');return;}if(this.prepareRepeat&&!await this.prepareRepeat())return;if(this.disposed)return;this.attempt=uid();await this.playRange(this.segment.startMs,this.segment.endMs,'repeat');}
 pause(){if(!this.running){if(this.recoveringLease)this.token++;return;}if(this.state==='COMMITTING'){this.pauseFrom='COMMITTING';this.emit();return;}const before=this.state;this.token++;this.adapter.cancelSeek?.();this.stopMedia();this.pauseFrom=before;this.pauseAt=this.adapter.position;if(before==='GAP')this.gapLeft=this.gapLeft===null?null:Math.max(0,this.gapUntil-performance.now());if(before==='SEEKING'){this.attempt=undefined;this.pauseFrom='READY';}this.set('PAUSED');}
 async resume(){if(this.continuation){const next=this.continuation;this.continuation=undefined;await next();return;}if(this.pending){await this.retry();return;}if(this.state==='GAP'&&this.gapLeft===null){this.nextAfterGap();return;}if(this.state==='INTERRUPTED'||this.state==='ERROR'){await this.start();return;}if(this.state!=='PAUSED'){await this.start();return;}if(this.pauseFrom==='GAP'){this.gapUntil=performance.now()+(this.gapLeft??0);this.set('GAP');if(this.gapLeft===null)this.nextAfterGap();return;}if(this.pauseFrom==='PLAYING'&&Math.abs(this.adapter.position-this.pauseAt)<80&&this.adapter.valid){await this.playRange(this.pauseAt,this.playbackEnd,this.purpose,true);}else await this.start();}
 interrupt(reason:string,reconnect=false){this.reconnectRequired=reconnect;if(this.pending)this.pauseFrom='COMMITTING';this.token++;this.adapter.cancelSeek?.();this.stopMedia();this.attempt=undefined;this.error=reason;if(!this.pending)this.set('INTERRUPTED');else this.emit();}
 private async persist(type:string,payload:Record<string,any>,after:()=>void|Promise<void>){const request=this.client.envelope(type,payload);this.pending={request,after};this.pauseFrom='READY';this.set('COMMITTING');await this.retry();}
 async retry(){
  if(!this.pending||this.retrying||this.disposed)return;
  this.retrying=true;const item=this.pending;let snapshot:Clip;
  try{snapshot=await this.client.send(item.request);}
  catch(e){if(!this.disposed){this.error=message(e);this.reconnectRequired=['STALE_BINDING','STALE_EPOCH','REVISION_CONFLICT','PROTOCOL_MISMATCH'].includes((e as AppError).code);this.set('ERROR');}return;}
  finally{this.retrying=false;}
  this.client.clip=snapshot;this.pending=undefined;if(this.disposed)return;this.error='';this.reconnectRequired=false;
  if(this.pauseFrom==='COMMITTING'){this.continuation=item.after;this.pauseFrom='READY';this.set('PAUSED');return;}
  try{await item.after();}catch(e){if(!this.disposed)this.interrupt(message(e));}
 }

 private async boundary(){this.stopMedia();if(this.purpose==='prompt'){this.set('WAIT_ANSWER');return;}if(this.purpose==='answer'){this.set('WAIT_RATING');return;}if(this.purpose==='preview'){this.set('READY');return;}const attemptId=this.attempt;if(!attemptId)return;this.attempt=undefined;await this.persist('COMMIT_COMPLETION',{attemptId,segmentId:this.segment.id,segmentRevision:this.segment.revision},()=>this.afterRepeat());}
 private afterRepeat(){const done=complete(this.progress);const advance=()=>{if(done)void this.advance();else void this.start();};if(this.mode==='shadow'||!done&&this.clip.settings.listenGapMs>0){const gap=gapMs(this.segment,this.clip.settings,this.mode);this.gapLeft=gap;this.gapUntil=performance.now()+(gap??0);this.nextAfterGap=advance;this.set('GAP');}else advance();}
 private async advance(){const next=this.clip.segments.findIndex((s,i)=>i>this.current&&!complete(this.clip.progress[s.id])&&(!this.practiceIds||this.practiceIds.has(s.id)));if(next<0){this.set('PRACTICE_DONE');return;}await this.select(next,this.clip.settings.nextPolicy!=='manual');}
 async select(index:number,autoplay=false){
  if(this.pending||this.disposed)return;
  const token=++this.token;this.continuation=undefined;this.adapter.cancelSeek?.();this.stopMedia();this.attempt=undefined;
  const next=Math.max(0,Math.min(index,this.clip.segments.length-1));
  await this.persist('SAVE_CHECKPOINT',{current:next},async()=>{
   if(this.disposed||token!==this.token)return;this.current=next;this.set('SEEKING');
   await this.adapter.seek(this.segment.startMs);if(this.disposed||token!==this.token)return;
   this.set('READY');if(autoplay)await this.start();
  });
 }
 async changeMode(mode:Mode,clearPractice=false){
  if(this.shadowOnly&&mode==='listen')mode='shadow';
  if(this.pending||this.disposed)return;if(mode==='cue'&&!this.adapter.cueSafe)throw new AppError('BOUNDARY_UNSAFE');
  this.pause();this.token++;this.continuation=undefined;this.stopMedia();this.attempt=undefined;
  await this.persist('SAVE_CHECKPOINT',{mode,...(clearPractice?{practiceIds:null}:{})},()=>{this.mode=mode;if(clearPractice)this.practiceIds=undefined;this.set('READY');});
 }
 async restartPractice(hard=false){
  if(this.pending||this.disposed)return;
  this.pause();this.token++;this.adapter.cancelSeek?.();this.continuation=undefined;this.stopMedia();this.attempt=undefined;
  await this.persist(hard?'RESTART_DIFFICULT':'RESTART_SESSION',{},async()=>{
   if(this.shadowOnly&&this.clip.mode==='listen')await this.changeMode('shadow');
   this.current=this.clip.current;this.mode=this.clip.mode;this.practiceIds=this.clip.practiceIds?new Set(this.clip.practiceIds):undefined;
   const token=++this.token;this.set('SEEKING');await this.adapter.seek(this.segment.startMs);
   if(!this.disposed&&token===this.token)this.set('READY');
  });
 }
 async saveSettings(settings:Clip['settings'],mode?:Mode,resumePlayback=false){
  if(this.shadowOnly){settings=shadowSettings(settings);if(mode==='listen')mode='shadow';}
  if(this.pending||this.disposed)return;if(mode==='cue'&&!this.adapter.cueSafe)throw new AppError('BOUNDARY_UNSAFE');if(!this.adapter.rates.includes(settings.rate))throw new AppError('INVALID_REQUEST');
  this.pause();this.token++;this.continuation=undefined;this.attempt=undefined;
  await this.persist('SAVE_CHECKPOINT',{settings,...(mode?{mode}:{})},async()=>{if(mode)this.mode=mode;this.adapter.setRate(settings.rate);this.pauseFrom='READY';this.set('READY');if(resumePlayback)await this.start();});
 }
 async progressAction(action:string){if(this.pending)return;this.pause();await this.persist('UPDATE_PROGRESS',{segmentId:this.segment.id,action},()=>{this.set('READY');if(action==='early'||action==='skip')void this.advance();});}
 async beginQuestions(){
  if(this.pending||this.disposed)return;this.continuation=undefined;if(!this.adapter.cueSafe)throw new AppError('BOUNDARY_UNSAFE');this.pause();this.adapter.setCueHidden?.(true);
  await this.persist('START_QUESTIONS',{preserve:!(this.clip.questions.length===this.clip.segments.length-1&&this.clip.questions.every(q=>q.rating))},()=>{
   this.mode='cue';this.purpose='prompt';this.questionIndex=Math.max(0,this.clip.questions.findIndex(q=>!q.rating));this.set('READY');
  });
 }
 async prompt(){if(!this.adapter.cueSafe)throw new AppError('BOUNDARY_UNSAFE');this.continuation=undefined;const q=this.question;if(!q)return;const s=this.clip.segments.find(s=>s.id===q.cueId)!;const target=this.clip.segments.find(s=>s.id===q.targetId)!;await this.playRange(s.startMs,promptEnd(s.startMs,s.endMs,target.startMs,this.adapter.formal),'prompt');}
 async reveal(){if(this.pending||!['WAIT_ANSWER','WAIT_RATING'].includes(this.state))return;const q=this.question;if(!q)return;await this.persist('REVEAL_ANSWER',{questionId:q.id},()=>{const s=this.clip.segments.find(s=>s.id===q.targetId)!;void this.playRange(s.startMs,s.endMs,'answer');});}
 async rate(rating:'can'|'stuck'|'skip'){if(this.pending||rating!=='skip'&&this.state!=='WAIT_RATING')return;this.pause();await this.persist('RATE_ANSWER',{questionId:this.question.id,rating},async()=>{if(this.questionIndex<this.clip.questions.length-1){this.questionIndex++;this.purpose='prompt';this.set('READY');if(this.clip.settings.nextPolicy==='auto')await this.prompt();}else{this.mode='done';this.set('PRACTICE_DONE');}});}
 async preview(start:number,end:number){if(this.pending)return;this.pause();await this.playRange(start,end,'preview');}
 get saving(){return Boolean(this.pending);}
 get answerCaption(){return this.mode==='cue'&&this.purpose==='answer'?this.clip.segments.find(s=>s.id===this.question?.targetId):undefined;}
 get caption(){if(!this.clip.settings.showJapanese)return '';if(this.mode==='cue'&&this.purpose!=='answer')return '';const cue=(this.adapter.cues.length?this.adapter.cues:this.clip.segments).find(c=>c.startMs<=this.adapter.position&&c.endMs>this.adapter.position);return cue?cue.text??'':'';}
 dispose(release=true){this.disposed=true;this.token++;this.adapter.cancelSeek?.();cancelAnimationFrame(this.frame);clearInterval(this.renewal);this.stopMedia();this.adapter.setCueHidden?.(false);this.cleanup.forEach(fn=>fn());if(release)void this.client.release();}
}
