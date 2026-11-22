import {PlaybackSubtitleTimeline} from '../desktop/playback-subtitle-timeline';
import {LivePlaybackCaptions} from '../desktop/live-playback-captions';
import {desktopTraining} from './config';
import {EnglishTranslation} from './english-translation';
import {SessionTranslations} from './session-translations';
import {languageCode} from './source-language';
import {NativeControls} from './native-controls';
import {practiceAppearance} from './practice-appearance';
import {SubtitleOverlay} from './subtitle-overlay';
import {compactButton} from './compact-controls';
import {afterPractice} from './training-flow';
import {AppError, resolveSource, Clip, Mode, complete, cueFingerprint, formatTime, message, results, safeCue, splitCues, Segment, uid, shadowSettings, validateSegments} from './domain';
import {Client} from './client';
import {VideoAdapter} from './player';
import {Engine} from './engine';
import type {Request} from './storage';
import {button, captureFocus, confirmAction, h, notify, status, text} from './dom';
import type {AsrTransport} from './local-asr-client';
import {LiveSpeech} from './live-speech';
import {NonDialogue,SearchPhase} from './dialogue-search';
import {continueSentence} from './live-boundary';
import type {TurnAnalyzer} from './turn-model';
import {loadPageAudio} from './prepared-audio';
import {prepareTimeline} from './prepare-timeline';
import {AudioSourceUnavailable} from './page-audio';
import {capturePreparedAudio} from './prepared-capture';
export type WorkspaceOptions={savedClips?:Clip[];printedHistory?:Segment[];targetDefault?:number;external?:boolean;demo?:boolean;onRecords:()=>void;onExit:()=>void;onReconnect?:()=>void;asrTransport?:AsrTransport;turnAnalyzer?:TurnAnalyzer;media?:{title:string;url:string};preAnalyze?:boolean;audioLoader?:typeof loadPageAudio;};
export class Workspace {
 private sourceLanguage?:string;private english=new EnglishTranslation();private translationBusy=false;private translationProgress='准备英文译文…';private translationGeneration=0;private translations?:SessionTranslations;private languageInput?:HTMLSelectElement;private englishButton?:HTMLButtonElement;
 private englishWanted=false;
 private checkedEnglishLanguage?:string;
 private previewKey='';
 private previewEnglish='';
 private previewTask?:string;
 private originalPlaybackBusy=false;
 private playbackTimeline=new PlaybackSubtitleTimeline();
 private timelineRevision=0;
 private playbackReader?:LivePlaybackCaptions;
 private nativeCaptions=false;
 private lastCaptionStatus?:string;
 private preparingFile=false;
 private hasCaptionText=false;
 setDesktopNativeCaptions(value:boolean){this.nativeCaptions=value;}
 private stopPlaybackReader(){this.playbackReader?.dispose();this.playbackReader=undefined;}
 private analysisPending=false;private analysisStatus='正在读取音轨';private captureAvailable=false;private captureRetry=false;
 private newPractice?:HTMLButtonElement;
 private nativeControls?:NativeControls;private transitioning=false;private flowQueued=false;
 private retryLive?:()=>Promise<void>;private live?:LiveSpeech;private liveAbort?:AbortController;private discovering=false;private livePhase:SearchPhase='listening';private searchDone=false;private continuous=false;private nextPosition=0;private pendingAutoplay=false;private appendSave=false;private initialMode:Mode='shadow';private initialTarget=20;
 readonly root=h('div',{class:'sg workspace'});private controls=h('div',{class:'controls-area'});private notices=h('div');private noticeKey='';private announcement=h('div',{class:'sr-only','data-workspace-announcement':'',role:'status','aria-live':'polite','aria-atomic':'true'});private subtitles:SubtitleOverlay;private time=h('span',{class:'time'});private seekbar=h('progress',{class:'play-progress',max:1,value:0,'aria-label':'当前播放进度'});private extras=h('div');private engine?:Engine;private stage:'practice'|'cue'|'result'='practice';private settingsForm?:{engine?:Engine;form:HTMLDivElement;target:HTMLInputElement;captions:HTMLButtonElement};private settingsTimer?:ReturnType<typeof setTimeout>;private settingsDirty=false;private settingsReady=false;private settingsSaving=false;private settingsRevision=0;private showCaptions=true;private captionFrame=0;private disposed=false;private actionBusy=false;private lifecycle=new AbortController();private error='';private pendingClipSave?:Request;private onMetadata:()=>void;
 constructor(readonly adapter:VideoAdapter,readonly client:Client,private options:WorkspaceOptions){
  try{this.englishWanted=localStorage.getItem('shengge.englishSubtitles')==='on';}catch{}
  if(desktopTraining)for(const clip of options.savedClips??[]){
   if(clip.videoKey!==adapter.videoKey||Math.abs(clip.durationMs-adapter.duration)>200)continue;
   for(const s of clip.segments)if(s.text)this.playbackTimeline.add({start:s.startMs/1000,end:s.endMs/1000,text:s.text},false);
  }
  this.hasCaptionText=adapter.cues.some(c=>!!c.text);
  const v=adapter.video;if(adapter.valid)adapter.setRate(1);
  const syncOriginalPlayback=()=>{if(!this.disposed&&(!this.engine||this.discovering))this.renderControls();};
  v.addEventListener('play',syncOriginalPlayback,{signal:this.lifecycle.signal});v.addEventListener('pause',syncOriginalPlayback,{signal:this.lifecycle.signal});v.addEventListener('ended',syncOriginalPlayback,{signal:this.lifecycle.signal});
  if(!options.external&&!desktopTraining){v.controls=Boolean(options.media);v.playsInline=true;const screen=h('div',{class:'video-screen'},v);screen.append(button('⛶',()=>screen.requestFullscreen(),'fullscreen',{'aria-label':'全屏视频'}));this.root.append(screen);}
  this.subtitles=new SubtitleOverlay(v);
  if(options.external)this.nativeControls=new NativeControls(v);
  if(options.external)this.newPractice=button('从头新建练习',()=>void this.act(async()=>{this.engine?.pause();await this.adapter.seek(0);await this.beginLive(true,true);}).finally(()=>{if(!this.disposed)this.renderControls();}), 'text small',{'aria-label':'从头新建练习，保留原记录'});
  this.root.classList.add('compact-workspace');this.extras.className='compact-extras';
  this.root.append(h('div',{class:'media-timeline'},this.seekbar),h('div',{class:'practice-toolbar'},this.controls,this.extras,this.newPractice,this.nativeControls?.root,practiceAppearance(this.root,adapter.videoKey),compactButton('close','关闭',()=>options.onExit(),{class:'button compact-icon dock-close'})),this.notices,this.announcement);
  this.initialTarget=options.targetDefault??(options.demo?3:20);if(!adapter.cues.length&&!options.external&&!options.preAnalyze)this.live=new LiveSpeech(adapter,options.asrTransport,options.turnAnalyzer);
  this.onMetadata=()=>{this.renderControls();this.showNotice();};v.addEventListener('loadedmetadata',this.onMetadata);if(Number.isFinite(v.duration))this.onMetadata();this.updateVideo();this.render();
 }
 private updateVideo=()=>{if(this.disposed)return;const ms=this.adapter.position;this.time.textContent=`${formatTime(ms)} / ${formatTime(this.adapter.duration||0)}`;this.seekbar.value=ms/(this.adapter.duration||1);this.updateSubtitle();this.captionFrame=requestAnimationFrame(this.updateVideo);};
 setDesktopCaptions(visible:boolean){this.showCaptions=visible;this.updateSubtitle();}
 private playbackCaption(){
  const lines=this.adapter.cues,ms=this.adapter.position;
  let lo=0,hi=lines.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(lines[mid].startMs<=ms)lo=mid+1;else hi=mid;}
  const line=lines[lo-1];return line&&ms<line.endMs?line:undefined;
 }
 private updateSubtitle(){
  const e=this.engine,visible=e&&!this.discovering&&this.showCaptions&&['listen','shadow'].includes(e.mode);const s=e?.segment;
  const preview=this.showCaptions && this.discovering ? this.live?.preview : undefined;
  const key=preview && this.english.enabled ? JSON.stringify([preview.text,preview.reference]) : '';
  if(this.previewKey!==key){
   this.previewKey=key;this.previewEnglish='';
   if(preview && key){this.previewTask=key;void this.english.translate(preview.text,preview.language,preview.reference).then(value=>{
    if(!this.disposed && this.previewKey===key)this.previewEnglish=value??'';
   }).catch(()=>{}).finally(()=>{if(this.previewTask===key)this.previewTask=undefined;});}
  }
  const ordinary=desktopTraining&&!e&&!this.discovering;
  const line=visible?s:desktopTraining&&this.showCaptions&&!this.discovering?(ordinary?this.playbackCaption():e?.answerCaption):undefined;
  const video=this.adapter.video;
  const oldStatus=this.lastCaptionStatus;
  const missingPractice=desktopTraining&&visible&&s&&!s.text&&!this.playbackTimeline.match(s.startMs/1000,s.endMs/1000);
  const listen=(ordinary||missingPractice)&&this.showCaptions&&!this.nativeCaptions&&!this.hasCaptionText&&!this.preparingFile;
  if(listen&&!video.paused&&!video.ended&&!video.seeking&&video.readyState>=3){
   this.playbackReader??=new LivePlaybackCaptions(video,()=>this.sourceLanguage,this.playbackTimeline);
  }else if(!listen)this.stopPlaybackReader();
  this.lastCaptionStatus=this.playbackReader?.status;
  if(desktopTraining&&(oldStatus!==this.lastCaptionStatus||this.timelineRevision!==this.playbackTimeline.revision)){
   this.timelineRevision=this.playbackTimeline.revision;this.root.dispatchEvent(new Event('desktop-state'));
  }
  const cached=desktopTraining&&this.showCaptions&&!this.discovering&&line&&!line.text?this.playbackTimeline.match(line.startMs/1000,line.endMs/1000):undefined;
  const discoveringText=desktopTraining&&this.showCaptions&&this.discovering&&!this.nativeCaptions&&e?.mode!=='cue'
   ?this.playbackTimeline.at(video.currentTime):'';
  const practiceText=missingPractice?this.playbackTimeline.at(video.currentTime):'';
  const caption=preview?.text||line?.text||cached||practiceText||discoveringText||(ordinary&&this.showCaptions&&!this.nativeCaptions&&!this.hasCaptionText?this.playbackTimeline.text(video.currentTime,performance.now()/1000):'');
  const hint=listen&&!caption&&!this.playbackReader?.hasLines
   ? video.paused?'播放后自动识别字幕':this.lastCaptionStatus??'正在准备自动字幕…'
   : '';
  this.subtitles.setText(caption,preview?this.previewEnglish:ordinary||this.english.enabled?line?.englishText??'':'',hint);
  const code=this.sourceLanguage??this.live?.detectedLanguage??languageCode(s?.language);
  if(this.english.enabled && code && this.english.activeLanguage!==code){this.english.disable();this.checkedEnglishLanguage=undefined;this.translationGeneration++;}
  if(this.englishWanted && code && code!=='en' && !this.translationBusy && !this.english.enabled && this.checkedEnglishLanguage!==code){
   this.checkedEnglishLanguage=code;
   void this.english.canResume(code).then(available=>{
    if(available && !this.disposed && this.englishWanted && this.checkedEnglishLanguage===code && !this.translationBusy && !this.english.enabled)void this.enableEnglish(code);
   });
  }
  if(this.englishButton){
   this.englishButton.disabled=this.translationBusy||code==='en';
   const label=this.translationBusy?this.translationProgress:this.english.enabled?'关闭英文译文':this.englishWanted&&!code?'等待原声 · 取消英文译文':'开启英文译文';
   if(this.englishButton.textContent!==label)this.englishButton.textContent=label;
  }
  const heard=e&&s&&!this.discovering&&['listen','shadow'].includes(e.mode)&&e.state==='PLAYING'&&
   !video.paused&&!video.seeking&&video.readyState>=3&&this.adapter.position>s.startMs&&this.adapter.position<=s.endMs+150;
  this.sessionTranslations().update(visible?s:undefined,heard?s:undefined,Boolean(this.previewTask));
 }
 private sessionTranslations(){
  return this.translations??=new SessionTranslations(()=>{
   const clip=this.client.clip;if(this.disposed||!this.adapter.valid||!clip||this.engine?.clip.id!==clip.id)return;
   const language=this.sourceLanguage??this.live?.detectedLanguage??languageCode(this.engine?.segment.language);
   return {clipId:clip.id,epoch:this.client.epoch,generation:this.translationGeneration,language,
    enabled:Boolean(this.client.owner)&&this.englishWanted&&this.english.enabled&&this.english.activeLanguage===language,segments:clip.segments};
  },segment=>this.english.translate(segment.text!,segment.language,this.live?.referenceAt(segment)),
   (clipId,segment,value)=>this.client.saveTranslation(clipId,segment.id,segment.text!,value));
 }
 private setSourceLanguage(value:string){
  this.sourceLanguage=languageCode(value);this.stopPlaybackReader();this.live?.useLanguage(this.sourceLanguage);
  this.checkedEnglishLanguage=undefined;this.english.disable();this.translationGeneration++;this.renderControls();
 }
 private requestEnglish(wanted:boolean){
  if(this.englishWanted!==wanted)this.translationGeneration++;
  this.englishWanted=wanted;
  if(this.live)this.live.englishRequested=wanted;
  try{localStorage.setItem('shengge.englishSubtitles',wanted?'on':'off');}catch{}
 }
 private async toggleEnglish(){
  const language=this.sourceLanguage??this.live?.detectedLanguage??languageCode(this.engine?.segment.language);
  if(this.english.enabled || this.englishWanted&&!language){
   this.requestEnglish(false);this.english.disable();return;
  }
  this.requestEnglish(true);
  if(language && language!=='en')await this.enableEnglish(language);
 }
 private async enableEnglish(language:string){
  this.translationGeneration++;
  this.checkedEnglishLanguage=language;
  this.translationBusy=true;this.translationProgress='准备英文译文…';try{await this.english.enable(language,fraction=>{this.translationProgress=fraction>=1?'正在准备英文译文…':`下载翻译模型 ${Math.round(fraction*100)}%`;});}catch(e){this.error=message(e);this.showNotice();}finally{this.translationBusy=false;if(!this.disposed)this.renderControls();}
 }

 private originalPlaybackControl(){return compactButton(this.adapter.video.paused?'play':'pause',this.adapter.video.paused?'播放原视频':'暂停原视频',()=>void this.toggleOriginalPlayback(),{class:'button compact-icon dock-play','data-focus-key':'original-playback',disabled:this.originalPlaybackBusy||!Number.isFinite(this.adapter.duration)});}
 private async toggleOriginalPlayback(){
  if(this.originalPlaybackBusy||this.disposed)return;this.originalPlaybackBusy=true;
  try{
   if(!this.adapter.valid)throw new Error('视频已变化，请重新连接声格。');
   if(!this.adapter.video.paused)this.adapter.pause();
   else {if(this.adapter.video.ended||this.adapter.position>=this.adapter.duration-100)await this.adapter.seek(0);if(!this.disposed)await this.adapter.play();}
  }catch(e){if(!this.disposed){this.error=message(e);this.showNotice();}}
  finally{this.originalPlaybackBusy=false;if(!this.disposed)this.renderControls();}
 }
 private async act(action:()=>Promise<any>|any){if(this.actionBusy)return;const restore=captureFocus(this.root,previous=>this.focusFallback(previous));this.actionBusy=true;this.error='';this.retryLive=undefined;this.searchDone=false;try{await action();}catch(e){this.error=message(e);this.showNotice();}finally{this.actionBusy=false;restore();if(this.settingsReady)queueMicrotask(()=>void this.saveCompactSettings());if(this.engine?.state==='PRACTICE_DONE')this.engineChanged();}}
 private showNotice(){
  const e=this.engine;let content='';let action:{label:string;run:()=>void}|undefined;let error=false;
  if(this.error){content=this.error;error=true;if(this.pendingClipSave)action={label:'重试保存练习',run:()=>void this.act(()=>this.finishSave())};else if(this.retryLive){const retry=this.retryLive;action={label:this.captureRetry?'重新采集（从头）':this.analysisPending?'继续分析':'重试识别',run:()=>void this.act(retry)};}}
  else if(this.discovering||this.retryLive){content='';}
  else if(e?.state==='READY'&&e.segment.source==='asr'&&this.stage==='practice'){content=`时间轴已就绪 · ${e.clip.segments.length} 句`;}
  else if(this.searchDone&&this.stage==='practice'){content=e?'对白已练完。至少两句可进入接话自评。':'视频已结束，没有更多可练习的对白。';if(e&&safeCue(e.clip.segments))action={label:'开始接话自评',run:()=>void this.act(()=>this.toStage('cue'))};}
  else if(e?.error){content=e.error;error=true;action={label:e.reconnectRequired?'重新连接':e.saving?'重试保存':'继续',run:()=>void this.act(()=>e.reconnectRequired?(this.options.onReconnect??(()=>location.reload()))():e.saving?e.retry():e.resume())};}
  else if(e?.state==='PRACTICE_DONE'&&this.stage==='practice'){content='本轮练习完成。';if(this.adapter.cueSafe&&safeCue(e.clip.segments))action={label:'开始接话自评',run:()=>void this.act(()=>this.toStage('cue'))};}
  else if(e&&!e.running&&this.stage==='practice'&&!e.practiceIds&&e.clip.segments.every(s=>complete(e.clip.progress[s.id])||e.clip.progress[s.id].skipped)){content='本轮复读已完成，可以继续下一阶段。';action={label:'继续下一阶段',run:()=>void this.act(()=>e.start())};}
  else if(!this.engine&&!Number.isFinite(this.adapter.duration))content=this.options.demo?'正在载入教学视频…':'请先在原站载入视频。';
  else if(!this.engine&&!this.options.preAnalyze)content='按原片顺序边播边练 · 无对白片段正常播放';
  // Keep unchanged live notices mounted so routine renders do not repeat alerts.
  const key=JSON.stringify([content,action?.label,error,this.captureAvailable]);if(key===this.noticeKey)return;this.noticeKey=key;
  this.notices.replaceChildren(...(content?[status(content,action,error),...(error&&this.analysisPending&&!this.pendingClipSave?[
   ...(this.captureAvailable?[button(`从头采集 ${formatTime(this.adapter.duration)} 音轨后分析`,()=>void this.act(()=>this.beginLive(true,true,undefined,false,true)),'soft small')]:[]),
   button('改用实时跟读',()=>void this.act(async()=>{this.analysisPending=false;await this.beginLive(true,true,undefined,true);}), 'text small')]:[])]:[]));
 }
 private announce(){
  const e=this.engine;if(!e||this.discovering){this.announcement.textContent='';return;}
  // Error, pause, gap and completion already have a visible live notice.
  if(this.error||e.error||['SEEKING','COMMITTING'].includes(e.state))return;
  let content='';
  if(this.stage==='cue'){
   const state=e.state==='WAIT_ANSWER'?'等待手动核对，答案未揭示。':e.state==='WAIT_RATING'?'原声核对结束，请自评。':e.state==='PLAYING'?'正在播放。':e.state==='READY'?'等待播放提示。':'';
   if(state)content=`接话第 ${e.questionIndex+1} / ${e.clip.questions.length} 题。${state}`;
  }else if(this.stage==='result'){
   const r=results(e.clip);content=`接话自评完成。已完成 ${r.completed} / ${e.clip.segments.length} 句，已自评核对 ${r.rated} / ${r.total} 题，卡住 ${r.stuck}，跳过 ${r.skipped}。`;
  }else if(['READY','PLAYING','GAP','PAUSED','PRACTICE_DONE'].includes(e.state)){
   const p=e.progress;content=`第 ${e.current+1} / ${e.clip.segments.length} 句，已完成 ${p.count} / ${p.target} 遍。`;
  }
  // Only numbers and fixed state labels are announced; target dialogue stays private.
  if(content&&content!==this.announcement.textContent)this.announcement.textContent=content;
 }
 async resume(clip:Clip){if(this.disposed)return;this.client.clip=clip;this.live?.useLanguage(this.sourceLanguage);if(Math.abs(clip.durationMs-this.adapter.duration)>1000||clip.subtitleFingerprint&&clip.subtitleFingerprint!==cueFingerprint(this.adapter.cues)){await this.acquire();if(this.disposed){await this.client.release();return;}this.error='视频时长或字幕有变化，请从当前播放位置重新练习。';this.render();return;}await this.acquire();if(this.disposed){await this.client.release();return;}this.engine=this.createEngine();await this.engine.attach();if(this.disposed)return;this.engine.addEventListener('change',this.engineChanged);this.continuous=!clip.sourceExhausted&&clip.segments.every(s=>s.source==='vad'||s.source==='turn');this.nextPosition=clip.segments.at(-1)!.endMs;this.stage=this.engine.mode==='cue'?'cue':this.engine.mode==='done'?'result':'practice';this.render();}
 desktopState(){
  const e=this.engine,mode=e?.mode??(this.discovering?this.initialMode:undefined);
  const byId=new Map(e?.clip.segments.map(s=>[s.id,s]));
  const ordinaryLines=this.adapter.cues.length?this.adapter.cues:this.playbackTimeline.ordered.map(l=>({startMs:l.start*1000,endMs:l.end*1000,text:l.text,englishText:undefined}));
  const rows=e?.mode==='cue'||e?.mode==='done'
   ? e.clip.questions.map((q,i)=>{const line=byId.get(q.targetId)!;return {...line,text:line.text||this.playbackTimeline.match(line.startMs/1000,line.endMs/1000),visible:!!q.rating||i===e.questionIndex&&q.revealed,rating:q.rating};})
   : (e?.clip.segments??ordinaryLines).map(s=>({...s,text:s.text||this.playbackTimeline.match(s.startMs/1000,s.endMs/1000),visible:true,rating:undefined}));
  return {captionStatus:this.playbackReader?.status,hasCaptionText:this.hasCaptionText,discovering:this.discovering,mode,index:e?.mode==='cue'?e.questionIndex:e?.current??-1,rows,active:!!e,busy:this.discovering||this.actionBusy||!!e?.saving};
 }
 async generateDesktopCaptions(signal:AbortSignal,progress:(value:string)=>void,capture=false){
  this.preparingFile=true;this.stopPlaybackReader();
  try{const source=this.adapter.video.currentSrc;
  const pcm=capture?await capturePreparedAudio(this.adapter,signal,progress):await loadPageAudio(this.adapter,signal,progress,false);
  const lines=await prepareTimeline(pcm,this.adapter.duration,0,signal,progress,this.options.asrTransport,this.sourceLanguage);
  signal.throwIfAborted();
  if(this.disposed||!this.adapter.valid||this.adapter.video.currentSrc!==source)throw Error('视频已切换，请重新生成字幕。');
  if(this.adapter.cues.length)throw Error('视频已有对白，已保留现有字幕。');
  await this.setDesktopLines(lines);
  }finally{this.preparingFile=false;}
 }
 async setDesktopLines(lines:Segment[],persist=true){
  if(this.engine||this.discovering||this.actionBusy)throw Error('请在开始练习前添加对白。');
  const sorted=[...lines].sort((a,b)=>a.startMs-b.startMs);
  validateSegments(sorted,this.adapter.duration);
  if(persist)await chrome.storage.local.set({['lines:'+this.adapter.videoKey]:sorted});
  this.adapter.cues.splice(0,this.adapter.cues.length,...sorted);this.hasCaptionText=sorted.some(line=>!!line.text);
  this.render();
 }
 async desktopPlayback(){
  await this.act(async()=>{if(this.engine){if(this.engine.running)this.engine.pause();else await this.engine.resume();}
   else if(this.adapter.video.paused)await this.adapter.play();else this.adapter.pause();});
  this.renderControls();
 }
 async desktopMode(mode:'listen'|'shadow'|'cue'){
  if(this.discovering||this.engine?.saving||this.actionBusy)return;
  await this.act(async()=>{
   if(mode!=='cue')this.initialMode=mode;
   if(!this.engine){
    const prior=(await this.client.call('LIST_RECORDS',{videoKey:this.adapter.videoKey,limit:1})).clips[0] as Clip|undefined;
    if(this.disposed)return;
    if(prior&&Math.abs(prior.durationMs-this.adapter.duration)<=1000&&(!prior.subtitleFingerprint||prior.subtitleFingerprint===cueFingerprint(this.adapter.cues))){
     this.adapter.pause();this.stopPlaybackReader();await this.resume(prior);
     if(!this.engine||this.error)return;
    }else{
     await this.beginLive(true,true,undefined,!this.adapter.cues.length);
     if(!this.engine||this.error||mode!=='cue')return;
    }
   }
   const e:Engine=this.engine;
   e.pause();
   if(mode==='cue'){
    if(!safeCue(e.clip.segments)&&this.continuous)await this.beginLive(false,true);
    if(this.disposed||this.error)return;
    if(!this.engine||!safeCue(this.engine.clip.segments))throw Error('接话至少需要两句互不重叠的对白。');
    await this.toStage('cue');
   }else{
    this.stage='practice';await e.changeMode(mode,true);await e.start();
   }
  });
  this.render();
 }
 private createEngine(){
  const e=new Engine(this.adapter,this.client,!desktopTraining);
  e.prepareRepeat=async()=>{if(['turn','vad'].includes(e.segment.source)&&(!e.segment.onsetVerified||(e.segment.onsetVersion??0)<3)){await this.refineStart();return false;}return true;};
  return e;
 }
 private async acquire(){try{await this.client.acquire();}catch(e){if((e as AppError).code==='SESSION_OWNED'&&await confirmAction('另一个页面正在使用这个视频，接管练习？','接管',this.lifecycle.signal))await this.client.acquire(true);else throw e;}}
 private async restoreDesktopAnswers(e:Engine){
  const key='legacyReceipt:'+this.adapter.videoKey,receipt=(await chrome.storage.local.get(key))[key];
  if(!receipt||receipt.fingerprint!==cueFingerprint(e.clip.segments)||!Array.isArray(receipt.ratings)||receipt.ratings.length!==e.clip.questions.length)return;
  if(receipt.ratings.some((r:unknown)=>!r)){
   for(const [i,rating] of receipt.ratings.entries()){
    const q=e.clip.questions[i];
    if(q.rating||!['can','stuck','skip'].includes(rating))continue;
    if(rating!=='skip')await this.client.call('REVEAL_ANSWER',{questionId:q.id});
    await this.client.call('RATE_ANSWER',{questionId:q.id,rating});
   }
   e.questionIndex=Math.max(0,e.clip.questions.findIndex(q=>!q.rating));
  }
  await chrome.storage.local.remove(key);
 }
 private async toStage(s:Workspace['stage']){if(this.engine?.saving)return;if(!this.engine)return;this.liveAbort?.abort();this.engine.pause();if(s==='cue'){await this.engine.beginQuestions();if(desktopTraining)await this.restoreDesktopAnswers(this.engine);}else if(this.engine.mode==='cue'||this.engine.mode==='done'||this.engine.practiceIds)await this.engine.changeMode('shadow',true);if(this.engine.saving)return;this.searchDone=false;this.stage=s;this.render();if(s==='cue'&&this.engine.mode==='cue')await this.engine.prompt();}
 private engineChanged=()=>{this.renderControls();this.scheduleFlow();if(this.settingsReady)queueMicrotask(()=>void this.saveCompactSettings());};
 private scheduleFlow(){
  if(this.retryLive||this.flowQueued||this.transitioning||this.disposed||this.discovering||this.actionBusy||this.pendingClipSave||this.error||this.engine?.error)return;
  const e=this.engine;if(!e||e.saving)return;
  const next=afterPractice(e.clip,e.mode,e.state,this.continuous&&this.nextPosition<this.adapter.duration-100,Boolean(e.practiceIds));if(!next)return;
  this.flowQueued=true;queueMicrotask(()=>{this.flowQueued=false;if(this.disposed||this.engine!==e||this.discovering||this.actionBusy||this.transitioning||e.state!=='PRACTICE_DONE')return;void this.advanceFlow(next);});
 }
 private async advanceFlow(next:'discover'|'cue'){
  this.transitioning=true;
  try{if(next==='discover')await this.beginLive(false);else await this.toStage('cue');}
  catch(e){this.error=message(e);}
  finally{this.transitioning=false;if(!this.disposed){this.render();this.scheduleFlow();}}
 }
 private render(){this.preserveFocus(()=>{this.renderControls();});}
 private async beginLive(fresh=true,internal=false,resumeAt?:number,realtime=!this.options.preAnalyze,capture=false){
  if(this.discovering||this.actionBusy&&!internal||this.pendingClipSave||this.engine?.saving)return;
  this.stopPlaybackReader();this.error='';this.captureAvailable=false;this.captureRetry=capture;this.retryLive=undefined;this.searchDone=false;this.stage='practice';this.engine?.pause();this.adapter.setCueHidden(false);this.discovering=true;this.livePhase='listening';const controller=new AbortController();this.liveAbort=controller;this.render();let retryPosition=this.adapter.position;
  try{
   if(fresh&&this.engine){this.initialTarget=this.engine.clip.settings.targetDefault;}
   if(fresh&&this.adapter.position>=this.adapter.duration-100)await this.adapter.seek(0);
   if(!fresh)await this.adapter.seek(resumeAt??this.nextPosition);
   if(controller.signal.aborted)return;retryPosition=this.adapter.position;
   if(!realtime&&this.adapter.cues.length){const segments=splitCues(this.adapter.cues,this.adapter.position,this.adapter.duration);if(!segments.length)throw new Error('当前位置之后没有可读取的对白。');this.continuous=false;this.queueLiveSave(segments,true);await this.finishSave();return;}
   if(fresh&&!realtime&&(this.options.external||this.options.preAnalyze)){
    this.analysisPending=true;this.live?.dispose();this.live=undefined;this.adapter.pause();if(this.engine)this.engine.discovering=true;
    const source=this.adapter.video.currentSrc,origin=capture?0:this.adapter.position;
    const progress=(value:string)=>{if(!controller.signal.aborted&&!this.disposed){this.analysisStatus=value;this.renderControls();}};
    progress('正在读取音轨');
    const pcm=capture?await capturePreparedAudio(this.adapter,controller.signal,progress):await (this.options.audioLoader??loadPageAudio)(this.adapter,controller.signal,progress);
    const segments=await prepareTimeline(pcm,this.adapter.duration,origin,controller.signal,progress,this.options.asrTransport,this.engine?.clip.segments.find(s=>s.language)?.language);
    if(controller.signal.aborted||this.disposed)return;
    if(!this.adapter.valid||this.adapter.video.currentSrc!==source)throw new Error('视频已变化，未保存错位练习。');
    this.continuous=false;this.nextPosition=this.adapter.duration;this.queueLiveSave(segments,true);this.pendingAutoplay=false;this.analysisPending=false;await this.finishSave();return;
   }
   if(!this.live){this.live=new LiveSpeech(this.adapter,this.options.asrTransport,this.options.turnAnalyzer,this.options.printedHistory);this.live.useLanguage(this.sourceLanguage);this.live.englishRequested=this.englishWanted;}if(this.engine)this.engine.discovering=true;
   let boundary=await this.live.detect(controller.signal,phase=>{this.livePhase=phase;this.renderControls();});if(this.disposed||controller.signal.aborted)return;
   if(!boundary){
    this.continuous=false;this.searchDone=true;
    if(desktopTraining&&!fresh&&this.engine&&(this.adapter.video.ended||this.adapter.position>=this.adapter.duration-100))await this.client.call('SAVE_CHECKPOINT',{sourceExhausted:true});
    return;
   }
   if(!fresh)boundary=continueSentence(boundary,this.nextPosition);
   this.nextPosition=boundary.endMs;this.continuous=true;
   const {caption,...interval}=boundary,segmentId=uid();
   this.queueLiveSave([{...interval,id:segmentId,revision:1,source:'turn',onsetVerified:true,onsetVersion:4}],fresh);await this.finishSave();
   const clipId=this.client.clip?.id;
   if(clipId)this.sessionTranslations().remember(clipId,segmentId);
   if(caption&&clipId)void caption.then(value=>{if(value&&!this.disposed&&this.client.clip?.id===clipId)return this.client.saveCaption(clipId,segmentId,value).then(()=>{if(desktopTraining&&!this.disposed)this.root.dispatchEvent(new Event('desktop-state'));});}).catch(()=>{});
  }catch(e){if(!this.disposed){this.captureAvailable=e instanceof AudioSourceUnavailable;this.error=controller.signal.aborted||(e as Error).name==='AbortError'?capture?'采集分析已停止，音轨未保存；重新采集会从片头开始。':'':message(e);retryPosition=this.live?.resumePosition??retryPosition;this.retryLive=async()=>{await this.adapter.seek(retryPosition);await this.beginLive(fresh,true,retryPosition,realtime,capture);};}}
  finally{if(this.liveAbort===controller)this.liveAbort=undefined;this.discovering=false;if(this.engine)this.engine.discovering=false;if(!this.disposed){this.render();this.scheduleFlow();}}
 }
 private async refineStart(){
  const e=this.engine;if(!e||this.discovering||e.saving)return;
  e.pause();this.retryLive=undefined;const segment={...e.segment};let skip=false;this.error='';this.searchDone=false;this.discovering=true;e.discovering=true;this.livePhase='listening';
  const controller=new AbortController();this.liveAbort=controller;this.render();
  try{
   const priorEnd=e.clip.segments[e.current-1]?.endMs??0;
   await this.adapter.seek(Math.max(priorEnd,segment.startMs-1600,0));if(!this.live){this.live=new LiveSpeech(this.adapter,this.options.asrTransport,this.options.turnAnalyzer,this.options.printedHistory);this.live.useLanguage(this.sourceLanguage);this.live.englishRequested=this.englishWanted;}
   const boundary=await this.live.detect(controller.signal,phase=>{this.livePhase=phase;this.renderControls();},segment.endMs);
   if(controller.signal.aborted||this.disposed)return;
   if(!boundary)skip=true;else {
   await this.client.call('REFINE_START',{segmentId:segment.id,segmentRevision:segment.revision,startMs:boundary.startMs,onsetVersion:3,text:boundary.text,confidence:boundary.confidence,language:boundary.language});
   e.dispose(false);this.engine=this.createEngine();await this.engine.attach();this.engine.addEventListener('change',this.engineChanged);
   this.discovering=false;this.render();if(!complete(this.engine.progress))await this.engine.start();}
  }catch(error){if(!this.disposed){if(error instanceof NonDialogue)skip=true;else {this.error=controller.signal.aborted||(error as Error).name==='AbortError'?'':message(error);this.retryLive=()=>this.refineStart();}}}
  finally{if(this.liveAbort===controller)this.liveAbort=undefined;this.discovering=false;if(this.engine)this.engine.discovering=false;if(!this.disposed)this.render();}
  if(skip&&!controller.signal.aborted&&!this.disposed){
   const next=e.clip.segments.findIndex((s,i)=>i>e.current&&!complete(e.clip.progress[s.id]));
   if(next>=0){await e.select(next,true);return;}
   this.nextPosition=Math.max(segment.endMs,e.clip.segments.at(-1)!.endMs);
   await this.beginLive(false,true);
  }
 }
 private queueLiveSave(segments:Segment[],fresh:boolean){
  const prior=this.client.clip;this.appendSave=!fresh&&Boolean(prior);
  if(this.appendSave){this.pendingClipSave=this.client.envelope('APPEND_SEGMENTS',{segments});this.pendingAutoplay=true;return;}
  const payload={videoKey:this.adapter.videoKey,url:this.options.media?.url??(this.options.demo?'demo:cafe':this.options.external?resolveSource(location.href).url:location.href),title:this.options.media?.title??(this.options.demo?'駅前のカフェ':document.title.slice(0,500)),name:segments.every(s=>s.source==='asr')?'整段跟读':'边播边练',durationMs:this.adapter.duration,subtitleFingerprint:cueFingerprint(this.adapter.cues),segments:this.appendSave?[...structuredClone(prior!.segments),...segments]:segments};
  this.pendingClipSave=this.appendSave?this.client.envelope('SAVE_CLIP',payload):{...this.client.envelope('SAVE_CLIP',payload),clipId:undefined,expectedRevision:undefined};this.pendingAutoplay=true;
 }
 private async finishSave(){
  if(!this.pendingClipSave||this.disposed)return;
  const append=this.appendSave;this.client.clip=await this.client.send(this.pendingClipSave);this.pendingClipSave=undefined;if(this.disposed)return;
  this.engine?.dispose(false);await this.client.release();await this.acquire();if(this.disposed){await this.client.release();return;}
  await this.client.call('SAVE_CHECKPOINT',append?{current:this.client.clip!.segments.length-1}:{mode:this.initialMode,settings:shadowSettings({...this.client.clip!.settings,targetDefault:this.initialTarget,showJapanese:this.showCaptions})});
  this.engine=this.createEngine();await this.engine.attach();if(this.disposed)return;this.engine.addEventListener('change',this.engineChanged);this.stage='practice';this.discovering=false;this.render();
  if(this.pendingAutoplay){this.pendingAutoplay=false;await this.engine.start();}
 }
 private focusFallback(previous?:HTMLElement):HTMLElement|null{
  const selectors= ['.status button:not(:disabled)','button[data-focus-key="transport"]:not(:disabled)','.controls-area button:not(:disabled)'];
  for(const selector of selectors){const target=Array.from(this.root.querySelectorAll<HTMLElement>(selector)).find(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length>0);if(target)return target;}
  return null;
 }
 private preserveFocus(update:()=>void){const restore=captureFocus(this.root,previous=>this.focusFallback(previous));update();restore();}
 private renderControls(){if(this.newPractice)this.newPractice.disabled=this.discovering||this.actionBusy||Boolean(this.pendingClipSave)||Boolean(this.engine?.saving);this.preserveFocus(()=>this.drawControls());this.announce();if(desktopTraining)this.root.dispatchEvent(new Event('desktop-state'));}
 private drawControls(){this.controls.replaceChildren();for(const child of Array.from(this.extras.children))if(child!==this.settingsForm?.form||this.discovering||this.engine&&!['listen','shadow'].includes(this.engine.mode))child.remove();this.showNotice();if(this.discovering){
   const preparing=this.analysisPending&&!this.captureRetry;
   this.controls.append(h('div',{class:'control-row'},
    preparing&&this.originalPlaybackControl(),
    preparing?button('暂停分析',()=>this.liveAbort?.abort(),'text small',{'data-focus-key':'live-pause'}):compactButton('pause',this.captureRetry?'停止采集分析（下次从头采集）':'暂停即时练习',()=>this.liveAbort?.abort(),{class:'button compact-icon dock-play','data-focus-key':'live-pause'}),
    text(this.analysisPending?this.analysisStatus:this.livePhase==='preparing'?this.live?.preparationStatus??'正在准备离线识别':this.livePhase==='waiting-review'?'正在识别 · 完成后从这里继续播放':this.livePhase==='confirming'?'正在确认这句对白':this.livePhase==='searching'?'原片继续播放 · 等待下一句对白':this.livePhase==='reconnecting'?'正在自动恢复音频采集':this.livePhase==='recovering'?'继续听取对白 · 自动确认完整句':'播放中 · 自动寻找下一句对白','muted')));
   return;
  }
  const e=this.engine;if(!e){
   const retry=this.retryLive,needsAnalysis=Boolean(this.options.preAnalyze)&&!this.adapter.cues.length;
   const label=retry?(this.captureRetry?'重新采集（从头）':this.analysisPending?'继续分析':this.error?'重试识别':'继续跟读'):needsAnalysis?'分析整段对白':'开始边播边练';
   const run=()=>retry?void this.act(retry):desktopTraining&&!needsAnalysis?void this.desktopMode('shadow'):void this.beginLive();
   this.controls.append(h('div',{class:'control-row'},needsAnalysis&&this.originalPlaybackControl(),
    needsAnalysis?button(label,run,'soft small',{'data-focus-key':'transport',disabled:!Number.isFinite(this.adapter.duration)||Boolean(this.pendingClipSave)}):compactButton('play',label,run,{class:'button compact-icon dock-play','data-focus-key':'transport',disabled:!Number.isFinite(this.adapter.duration)||Boolean(this.pendingClipSave)}),this.time));
   this.renderSettings();if(this.options.external)this.extras.append(button('学习记录',()=>this.options.onRecords(),'text small'));return;
  }
  if(!e.saving){const stage=e.mode==='cue'?'cue':e.mode==='done'?'result':'practice';if(this.stage!==stage){this.stage=stage;}}const busy=e.saving||e.state==='SEEKING';
  if(this.stage==='result'){const r=results(e.clip);this.controls.append(h('div',{class:'result-stats'},text(`已完成 ${r.completed} / ${e.clip.segments.length} 句`),text(`自评通过 ${r.percent===null?'暂无结果':r.percent+'%'}`),text(`已自评核对 ${r.rated} / ${r.total}`),text(`卡住 ${r.stuck}`),text(`跳过 ${r.skipped}`)),h('div',{class:'result-actions'},text('接话自评完成','muted'),button('重练困难句',()=>void this.act(()=>this.retryHard()),'soft',{disabled:busy||r.stuck===0}),button('返回学习记录',()=>this.options.onRecords(),'text')));return;}
  if(this.stage==='cue'){
   this.controls.append(text(e.state==='WAIT_ANSWER'?'请接出下一句，说完后点击「听原声核对」。':e.state==='WAIT_RATING'?'已听完原声，请选择自己的接话结果。':desktopTraining?'看上一句，接下一句。':'接话时隐藏视频画面与字幕，先听上一句提示。','cue-instruction'));const q=e.question;if(!q){this.stage='result';this.render();return;}const playing=e.state==='PLAYING'||e.state==='SEEKING';const canRate=e.state==='WAIT_RATING';
   this.controls.append(h('div',{class:'control-row'},text(`${e.questionIndex+1} / ${e.clip.questions.length}`,'counter'),button(playing?'Ⅱ 暂停':'↻ 重听提示',()=>void this.act(()=>playing?e.pause():e.prompt()),'text',{disabled:e.saving}),h('div',{class:'spacer'}),canRate?button('重听原声',()=>void this.act(()=>e.reveal()),'text',{disabled:busy}):button(e.state==='READY'?'▶ 播放提示':e.state==='PAUSED'?'▶ 继续播放':'听原声核对',()=>void this.act(()=>e.state==='READY'?e.prompt():e.state==='PAUSED'?e.resume():e.reveal()),'primary',{disabled:playing||busy}),canRate&&button('能接出',()=>void this.act(()=>e.rate('can')),'primary',{disabled:busy}),canRate&&button('卡住了',()=>void this.act(()=>e.rate('stuck')),'soft',{disabled:busy}),button('跳过',()=>void this.act(()=>e.rate('skip')),'text',{disabled:busy})));
   if(e.mode==='done'&&e.state==='PRACTICE_DONE'){this.stage='result';this.render();}return;
  }
  const retry=this.retryLive;const pause=['PLAYING','GAP','SEEKING'].includes(e.state);const p=e.progress;
  if(e.practiceIds)this.controls.append(h('div',{class:'inline'},text(`困难句练习 · 本轮 ${e.practiceIds.size} 句`,'muted'),button('返回全部句子',()=>void this.act(()=>this.toStage('practice')),'text small',{disabled:e.saving})));
  this.controls.append(h('div',{class:'control-row'},
   compactButton(pause?'pause':'play',retry?(this.captureRetry?'重新采集（从头）':this.analysisPending?'继续分析':this.error?'重试识别':'继续跟读'):pause?'暂停':e.state==='READY'&&e.segment.source==='asr'?'开始练习':'播放或继续',()=>void this.act(retry??(()=>pause?e.pause():e.resume())),{class:'button compact-icon dock-play','data-focus-key':'transport',disabled:e.saving||!retry&&complete(p)&&!['GAP','PAUSED'].includes(e.state)}),
   h('div',{class:'transport-secondary',role:'group','aria-label':'切换对白'},
    compactButton('previous','上一句',()=>void this.act(()=>e.select(e.current-1)),{disabled:busy||e.current===0}),
    compactButton('next','下一句',()=>e.current===e.clip.segments.length-1&&this.continuous?void this.beginLive(false):void this.act(()=>e.select(e.current+1)),{disabled:busy||e.current===e.clip.segments.length-1&&(!this.continuous||this.nextPosition>=this.adapter.duration-100)}),
    compactButton('replay','重播本句',()=>void this.act(()=>e.start()),{disabled:busy||complete(p)})),
   h('span',{class:'counter','aria-label':`第 ${e.current+1} 句，共 ${e.clip.segments.length} 句`},`${e.current+1} / ${e.clip.segments.length}`),this.time));
  this.renderSettings();this.extras.append(h('div',{class:'compact-actions',role:'group','aria-label':'本句操作'},...([['complete','提前完成','early'],['extra','加练5遍','extra'],['skip','跳过本句','skip'],['reset','重新练本句','reset']]as const).map(([icon,label,action])=>compactButton(icon,label,()=>void this.act(async()=>{if(action==='reset'&&!await confirmAction('将本句次数清零？','重新练习',this.lifecycle.signal))return;await e.progressAction(action);}),{disabled:busy}))));
 }
 private renderSettings(){
  const e=this.engine;
  if(!this.settingsForm){
   const target=h('input',{type:'number',min:1,max:100,step:1,value:this.initialTarget,'aria-label':'每句遍数','data-focus-key':'repeat-target',inputmode:'numeric'});
   const captions=compactButton('captions','显示字幕',()=>{this.showCaptions=!this.showCaptions;captions.setAttribute('aria-pressed',String(this.showCaptions));this.queueSettings(true);},{'aria-pressed':String(this.showCaptions)});
   const language=this.languageInput=h('select',{'aria-label':'原声语言','data-focus-key':'source-language'},...([['auto','自动识别原声'],['ja','日语'],['en','英语'],['zh','中文'],['ko','韩语'],['es','西班牙语'],['fr','法语'],['de','德语']] as const).map(([value,label])=>h('option',{value},label)));
   language.value=this.sourceLanguage??'auto';language.addEventListener('change',()=>this.setSourceLanguage(language.value));
   const english=this.englishButton=button('开启英文译文',()=>void this.toggleEnglish(),'text small',{'data-focus-key':'english-translation',disabled:true});
   const form=h('div',{class:'compact-preferences'},language,english,h('label',{class:'repeat-target','data-tooltip':'每句遍数'},h('span',{'aria-hidden':'true'},'×'),target),...(desktopTraining?[]:[captions]));
   target.addEventListener('input',()=>{if(!target.validity.valid||!target.value)return;this.initialTarget=Number(target.value);this.queueSettings();});
   target.addEventListener('change',()=>{if(!target.validity.valid||!target.value){target.value=String(this.initialTarget);return;}this.initialTarget=Number(target.value);this.queueSettings(true);});
   this.settingsForm={form,target,captions};
  }
  const pref=this.settingsForm;
  if(!this.settingsDirty&&!this.settingsSaving){this.initialTarget=e?.clip.settings.targetDefault??this.initialTarget;if(!desktopTraining)this.showCaptions=e?.clip.settings.showJapanese??this.showCaptions;if(pref.target.value!==String(this.initialTarget))pref.target.value=String(this.initialTarget);}
  pref.engine=e;pref.captions.setAttribute('aria-pressed',String(this.showCaptions));
  if(pref.form.parentElement!==this.extras)this.extras.prepend(pref.form);
 }
 private queueSettings(immediate=false){
  this.settingsRevision++;this.settingsDirty=true;this.settingsReady=false;clearTimeout(this.settingsTimer);
  if(immediate){this.settingsReady=true;void this.saveCompactSettings();}
  else this.settingsTimer=setTimeout(()=>{this.settingsReady=true;void this.saveCompactSettings();},400);
 }
 private async saveCompactSettings(){
  const e=this.engine;if(this.disposed||!this.settingsDirty||!this.settingsReady||this.settingsSaving||this.discovering)return;
  if(!e){this.settingsDirty=false;this.settingsReady=false;return;}
  if(e.saving||e.error||this.actionBusy||!['listen','shadow'].includes(e.mode))return;
  if(e.clip.settings.targetDefault===this.initialTarget&&e.clip.settings.showJapanese===this.showCaptions){this.settingsDirty=false;this.settingsReady=false;return;}
  const revision=this.settingsRevision;this.settingsSaving=true;
  try{await e.saveSettings(shadowSettings({...e.clip.settings,targetDefault:this.initialTarget,showJapanese:this.showCaptions}),desktopTraining?e.mode:'shadow',e.running);
   if(!e.saving&&revision===this.settingsRevision){this.settingsDirty=false;this.settingsReady=false;}
  }catch(error){this.error=message(error);this.showNotice();}
  finally{this.settingsSaving=false;if(!this.disposed){this.renderControls();if(this.settingsDirty&&!e.saving&&!e.error&&!this.error)queueMicrotask(()=>void this.saveCompactSettings());}}
 }
 async restart(){if(!this.engine||this.engine.saving)return;await this.engine.restartPractice();if(this.disposed||this.engine.saving)return;this.stage='practice';this.render();}
 async retryHard(){const e=this.engine;if(!e||e.saving)return;await e.restartPractice(true);if(this.disposed||e.saving)return;this.stage='practice';this.render();notify(`困难目标句 ${e.practiceIds?.size??0} 句已准备，其他句保留进度。`);}
 dispose(){this.stopPlaybackReader();this.english.disable();this.nativeControls?.dispose();clearTimeout(this.settingsTimer);this.subtitles.dispose();this.disposed=true;this.liveAbort?.abort();this.live?.dispose();this.lifecycle.abort();cancelAnimationFrame(this.captionFrame);this.adapter.video.removeEventListener('loadedmetadata',this.onMetadata);this.engine?.dispose();this.adapter.pause();}
}
