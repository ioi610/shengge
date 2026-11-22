import {desktopTraining} from './config';
import {playerSurface} from './site-player';
import {MediaEnd} from './media-end';
import {NativeMediaGaps} from './native-media-gaps';
import {AppError, Segment} from './domain';

const activeAdapters=new WeakMap<HTMLVideoElement,VideoAdapter>();

export class VideoAdapter {
 private controlled=0;private cueMask?:{element:HTMLElement;prior:string|null;style:HTMLStyleElement};
 private disposed=false;
 private playbackOwned=false;
 private nativeGaps=new NativeMediaGaps();
 readonly mediaEnd:MediaEnd;
 private durationAtConnect:number;
 private pendingSeek?:()=>void;
 readonly formal:boolean;
 readonly identity:string;
 readonly rates:number[];
 cueSafe:boolean;
 constructor(readonly video:HTMLVideoElement,readonly videoKey:string,readonly cues:Segment[]=[],private validate:()=>boolean=()=>true){this.durationAtConnect=video.duration*1000;this.formal=!videoKey.startsWith('demo:');this.identity=video.currentSrc;this.rates=this.formal?Array.from(new Set([1,video.playbackRate])):[0.5,0.75,1,1.25,1.5];this.cueSafe=true;activeAdapters.set(video,this);this.mediaEnd=new MediaEnd(video,()=>this.valid,()=>this.formal&&this.playbackOwned);}
 get duration(){return Math.round(this.video.duration*1000);}
 get position(){return this.video.currentTime*1000;}
 get valid(){return !this.disposed&&activeAdapters.get(this.video)===this&&this.video.isConnected&&this.validate()&&(!this.formal||this.video.currentSrc===this.identity&&Number.isFinite(this.duration)&&Math.abs(this.duration-this.durationAtConnect)<1000);}
 get ad(){return this.formal&&Boolean(document.querySelector('.ad-showing,.ad-interrupting'));}
 get seekingControlled(){return Boolean(this.pendingSeek)||Date.now()<this.controlled;}
 rememberNativeGap(from:number,to:number){if(this.formal&&this.valid)this.nativeGaps.observe(this.video.buffered,from,to);}
 isKnownNativeGap(from:number,to:number){return this.formal&&this.valid&&this.nativeGaps.matches(this.video.buffered,from,to);}
 rememberShortReplayStart(from:number,to:number,start:number){return this.formal&&this.valid&&this.nativeGaps.rememberShortStart(this.video.buffered,from,to,start);}
 replayDecodeStart(start:number,end:number){return this.formal&&this.valid?this.nativeGaps.replayStart(this.video.buffered,start,end):start;}
 pause(){if(activeAdapters.get(this.video)===this)this.video.pause();}
 async play(){if(!this.valid||this.ad)throw new AppError('CAPABILITY_LOST');this.playbackOwned=true;await this.video.play();if(!this.valid){this.pause();throw new AppError('CAPABILITY_LOST');}}
 /** Hide the whole original player, including burned-in/site subtitles. Audio
  * stays connected; the engine controls the prompt's guarded end separately. */
 setCueHidden(hidden:boolean){
  if(!hidden){if(this.cueMask){const {element,prior,style}=this.cueMask;if(prior===null)element.removeAttribute('data-shengge-cue-mask');else element.setAttribute('data-shengge-cue-mask',prior);style.remove();this.cueMask=undefined;}return;}
  if(this.cueMask||activeAdapters.get(this.video)!==this)return;
  const element=playerSurface(this.video);
  const style=document.createElement('style');const key='sg-'+Math.random().toString(36).slice(2);
  const selector=element===this.video?`[data-shengge-cue-mask="${key}"]`:`[data-shengge-cue-mask="${key}"] > :not(#shengge-panel)`;
  style.textContent=desktopTraining
   ? `[data-shengge-cue-mask="${key}"] .ytp-caption-window-container,[data-shengge-cue-mask="${key}"] .bpx-player-subtitle-wrap{visibility:hidden!important}video::cue{color:transparent;background:transparent}`
   : `${selector},${selector} *{visibility:hidden!important;pointer-events:none!important}`;
  this.cueMask={element,prior:element.getAttribute('data-shengge-cue-mask'),style};
  element.setAttribute('data-shengge-cue-mask',key);(element.getRootNode() instanceof ShadowRoot?element.getRootNode():document.head).appendChild(style);
 }
 cancelSeek(){this.pendingSeek?.();}
 async seek(ms:number){
  this.cancelSeek();
  if(!Number.isFinite(ms)||!Number.isFinite(this.duration)||ms<0||ms>this.duration)throw new AppError('INVALID_INTERVAL');
  if(!this.valid||this.ad)throw new AppError('CAPABILITY_LOST');
  this.pause();
  const startedAt=Date.now(),from=Math.round(this.position);
  console.debug('[声格定位诊断]',JSON.stringify({event:'start',at:startedAt,from,target:Math.round(ms)}));
  await new Promise<void>((resolve,reject)=>{
   let settled=false;
   const finish=(error?:AppError)=>{
    if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);
    this.video.removeEventListener('seeked',onSeek);
    this.video.removeEventListener('error',onError);
    this.video.removeEventListener('emptied',onError);
    if(this.pendingSeek===cancel)this.pendingSeek=undefined;
    this.controlled=error?0:Date.now()+80;
    console.debug('[声格定位诊断]',JSON.stringify({event:'finish',at:Date.now(),elapsedMs:Date.now()-startedAt,from,target:Math.round(ms),position:Math.round(this.position),error:error?.code}));
    if(error)reject(error);else resolve();
   };
   const cancel=()=>finish(new AppError('OPERATION_CANCELLED'));
   const onError=()=>finish(new AppError('CAPABILITY_LOST'));
   const onSeek=()=>{
    if(!this.valid||this.ad){onError();return;}
    if(this.video.seeking)return;
    finish(Math.abs(this.position-ms)>150?new AppError('SEEK_TIMEOUT'):undefined);
   };
   // A long seek (especially EOF -> first prompt) can fetch an evicted range.
   // Keep it cancellable while the original player buffers; do not require a
   // manual retry merely because fetching that range took over three seconds.
   // Poll also covers sites that swallow seeked after replacing their buffer.
   const poll=setInterval(()=>{
    if(!this.valid||this.ad){onError();return;}
    if(!this.video.seeking&&this.video.readyState>=2&&Math.abs(this.position-ms)<=150)finish();
   },100);
   const timer=setTimeout(()=>finish(new AppError('SEEK_TIMEOUT')),15000);
   this.pendingSeek=cancel;
   this.video.addEventListener('seeked',onSeek);
   this.video.addEventListener('error',onError);
   this.video.addEventListener('emptied',onError);
   if(Math.abs(this.position-ms)<30&&!this.video.seeking){onSeek();return;}
   try{this.video.currentTime=ms/1000;}catch{onError();}
  });
 }
 setRate(rate:number){if(!this.valid)throw new AppError('CAPABILITY_LOST');if(!this.rates.includes(rate))throw new AppError('INVALID_REQUEST');this.video.playbackRate=rate;}
 dispose(){this.setCueHidden(false);this.disposed=true;this.mediaEnd.dispose();this.cancelSeek();this.pause();}
}

export function waitForMetadata(video:HTMLVideoElement,signal:AbortSignal,timeoutMs=10000):Promise<void>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new AppError('OPERATION_CANCELLED'));return;}
  const ready=()=>video.readyState>=1&&Number.isFinite(video.duration)&&video.duration>0;
  if(ready()){resolve();return;}
  let settled=false;
  const finish=(code?:string)=>{if(settled)return;settled=true;clearTimeout(timer);video.removeEventListener('loadedmetadata',loaded);video.removeEventListener('error',failed);signal.removeEventListener('abort',cancelled);if(code)reject(new AppError(code));else resolve();};
  const loaded=()=>finish(ready()?undefined:'MEDIA_UNAVAILABLE');const failed=()=>finish('MEDIA_UNAVAILABLE');const cancelled=()=>finish('OPERATION_CANCELLED');
  const timer=setTimeout(()=>finish('MEDIA_TIMEOUT'),timeoutMs);
  video.addEventListener('loadedmetadata',loaded);video.addEventListener('error',failed);signal.addEventListener('abort',cancelled,{once:true});if(video.error)failed();
 });
}
