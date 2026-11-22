import test from 'node:test';
import assert from 'node:assert/strict';
import {MicVAD} from '@ricky0123/vad-web';
import {LiveSpeech} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
import {StreamingTurns} from '../src/turn-model';
import {StreamingSentences} from '../src/streaming-sentences';
import {BackgroundCaptions,Transcript} from '../src/background-captions';
import {NonDialogue} from '../src/dialogue-search';
import {VisualTurns} from '../src/visual-turns';
import type {UnconfirmedVisualTurns} from '../src/unconfirmed-visual-turns';

const tick=()=>new Promise<void>(r=>setImmediate(r));
class Video extends EventTarget {
 duration=630.764;currentSrc='blob:test';playbackRate=1;paused=true;seeking=false;isConnected=true;ended=false;readyState=4;error=null;
 position=528.958;playCalls=0;seeks:number[]=[];
 get currentTime(){return this.position;}
 set currentTime(n:number){this.seeks.push(n);this.jump(n);}
 jump(n:number){this.position=n;this.seeking=true;this.dispatchEvent(new Event('seeking'));queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
 pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
 async play(){this.playCalls++;this.paused=false;this.dispatchEvent(new Event('play'));}
}
async function setup(t:import('node:test').TestContext,options:{inference?:()=>Promise<void>;start?:()=>Promise<void>;ended?:boolean}={}){
 const contexts:{sampleRate:number;state:string;closeCalls:number;resume:()=>Promise<void>;close:()=>Promise<void>}[]=[];
 class Context {sampleRate:number;state='suspended';closeCalls=0;constructor(options:{sampleRate:number}){this.sampleRate=options.sampleRate;contexts.push(this);}async resume(){this.state='running';}async close(){this.state='closed';this.closeCalls++;}}
 for(const [key,value] of Object.entries({AudioContext:Context,document:Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null}),window:new EventTarget(),location:new URL('https://example.test/')})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>{if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);});
 }
 let callbacks:any;const order:string[]=[];
 const vad={processFrame:async(frame:Float32Array)=>{order.push('inference-start');await options.inference?.();callbacks.onFrameProcessed({isSpeech:0},frame);order.push('inference-end');},start:async()=>{await options.start?.();order.push('start');},pause:async()=>{order.push('reset');},destroy:async()=>{order.push('destroy');}};
 t.mock.method(MicVAD,'new',async(opts:any)=>{callbacks=opts;return vad as unknown as MicVAD;});
 const video=new Video();video.ended=options.ended??false;const adapter=new VideoAdapter(video as unknown as HTMLVideoElement,'bilibili:test');
 const speech=new LiveSpeech(adapter,async()=>({}),{analyze:async()=>({decision:undefined,frames:[]}),dispose:()=>{}});
 t.after(()=>{speech.dispose();adapter.dispose();});await tick();return {video,adapter,speech,vad,order,callbacks,contexts};
}
test('native 8:58 -> 10:11 jump replays the unexamined window instead of skipping it',async t=>{
 const {speech,video}=await setup(t);const controller=new AbortController();const starts:number[]=[];
 const pending=speech.detect(controller.signal,phase=>{if(phase==='listening'){starts.push(video.currentTime);if(starts.length===2)queueMicrotask(()=>controller.abort());}});
 const rejected=assert.rejects(pending,{name:'AbortError'});await tick();assert.deepEqual(starts,[528.958]);
 video.position=538.449;video.jump(611.0105);await rejected;
 assert.deepEqual(video.seeks,[528.958]);assert.deepEqual(starts,[528.958,528.958]);assert.equal(video.paused,true);
});
test('buffer recovery also restores the original window if the native player jumps while recovering',async t=>{
 const {speech,video}=await setup(t);const controller=new AbortController();const starts:number[]=[];
 const rejected=assert.rejects(speech.detect(controller.signal,phase=>{if(phase==='listening'){starts.push(video.currentTime);if(starts.length===2)queueMicrotask(()=>controller.abort());}}),{name:'AbortError'});
 await tick();video.readyState=1;video.dispatchEvent(new Event('waiting'));await tick();video.position=611.0105;video.readyState=4;video.dispatchEvent(new Event('canplay'));await rejected;
 assert.deepEqual(starts,[528.958,528.958]);assert.deepEqual(video.seeks,[528.958]);
});
test('stop drains in-flight inference before VAD reset, discarding queued old frames',async t=>{
 let release!:()=>void;const {speech,vad,order}=await setup(t,{inference:()=>new Promise<void>(r=>release=r)});
 const controller=new AbortController();const rejected=assert.rejects(speech.detect(controller.signal),{name:'AbortError'});await tick();
 const active=vad.processFrame(new Float32Array(512));await tick();const queued=vad.processFrame(new Float32Array(512));controller.abort();await tick();assert.equal(order.includes('reset'),false);
 release();await Promise.all([active,queued,rejected]);assert.deepEqual(order,['start','inference-start','inference-end','reset']);
});
test('aborting while capture starts disconnects the eventual stream without playing',async t=>{
 let release!:()=>void;const {speech,video,order}=await setup(t,{start:()=>new Promise<void>(r=>release=r)});
 const controller=new AbortController();const rejected=assert.rejects(speech.detect(controller.signal),{name:'AbortError'});await tick();controller.abort();await tick();assert.equal(order.includes('reset'),false);release();await rejected;
 assert.equal(video.playCalls,0);assert.deepEqual(order,['start','reset']);
});
test('pause during an awaited play cannot reactivate capture or leave playback running',async t=>{
 const {speech,video,order}=await setup(t);let release!:()=>void;video.play=async()=>{await new Promise<void>(r=>release=r);video.paused=false;};
 const controller=new AbortController();const rejected=assert.rejects(speech.detect(controller.signal),{name:'AbortError'});await tick();controller.abort();release();await rejected;
 assert.equal(video.paused,true);assert.deepEqual(order,['start','reset']);
});

test('subsecond native correction keeps captured context and does not loop back to the same gap',async t=>{
 let clock=1000;t.mock.method(performance,'now',()=>clock);
 const {speech,video,vad}=await setup(t);video.position=379.329;
 const controller=new AbortController();let starts=0;
 const rejected=assert.rejects(speech.detect(controller.signal,phase=>{if(phase==='listening')starts++;}),{name:'AbortError'});await tick();
 clock=2236;video.position=380.565;await vad.processFrame(new Float32Array(512));
 clock=2250;video.jump(381.179);await tick();
 clock=2282;video.position=381.211;await vad.processFrame(new Float32Array(512));await tick();
 assert.equal(starts,1);assert.deepEqual(video.seeks,[]);assert.equal(video.paused,false);
 controller.abort();await rejected;
});

test('8:21 native correction followed by waiting preserves audio without replaying the gap',async t=>{
 let clock=1000;t.mock.method(performance,'now',()=>clock);
 const {speech,video,vad,order}=await setup(t);video.position=495.559;const controller=new AbortController();let reconnects=0;
 const rejected=assert.rejects(speech.detect(controller.signal,phase=>{if(phase==='reconnecting')reconnects++;}),{name:'AbortError'});await tick();
 clock=6230;video.position=500.789;await vad.processFrame(new Float32Array(512));
 clock=6250;video.jump(501.552);video.readyState=1;video.dispatchEvent(new Event('waiting'));await tick();
 assert.equal(order.includes('reset'),false);assert.deepEqual(video.seeks,[]);
 clock=6500;video.readyState=4;video.dispatchEvent(new Event('canplay'));await tick();
 clock=6532;video.position=501.584;await vad.processFrame(new Float32Array(512));assert.equal(reconnects,1);assert.deepEqual(video.seeks,[]);assert.equal(video.paused,false);
 controller.abort();await rejected;
});

test('ordinary buffering resumes the same capture; explicit pause during buffering remains paused',async t=>{
 const {speech,video,order}=await setup(t);const controller=new AbortController();const rejected=assert.rejects(speech.detect(controller.signal),{name:'AbortError'});await tick();
 video.readyState=1;video.dispatchEvent(new Event('waiting'));await tick();video.readyState=4;video.dispatchEvent(new Event('canplay'));await tick();
 assert.deepEqual(video.seeks,[]);assert.equal(order.filter(x=>x==='start').length,1);assert.equal(order.includes('reset'),false);
 video.readyState=1;video.dispatchEvent(new Event('waiting'));await tick();video.pause();await rejected;video.readyState=4;video.dispatchEvent(new Event('canplay'));await tick();assert.equal(video.paused,true);assert.equal(video.playCalls,1);
});

test('capture uses a mono 16 kHz context and releases it exactly once',async t=>{
 const {speech,callbacks,contexts}=await setup(t);
 assert.equal(contexts.length,1);assert.equal(callbacks.audioContext.sampleRate,16000);
 assert.deepEqual(callbacks.workletOptions,{channelCount:1,channelCountMode:'explicit',channelInterpretation:'speakers'});
 speech.dispose();speech.dispose();await tick();
 assert.equal(contexts[0].closeCalls,1);
});

test('restarting a completed media element reacquires capture during playback and restores the origin',async t=>{
 const {speech,video,order}=await setup(t,{ended:true});video.ended=false;
 const play=video.play.bind(video);video.play=async()=>{await play();if(video.playCalls===1)video.position+=.1;};
 const controller=new AbortController();const rejected=assert.rejects(speech.detect(controller.signal,phase=>{if(phase==='listening')queueMicrotask(()=>controller.abort());}),{name:'AbortError'});
 await rejected;assert.equal(order.filter(x=>x==='start').length,2);assert.deepEqual(video.seeks,[528.958]);assert.equal(video.playCalls,2);assert.equal(video.paused,true);
});

test('cancelling EOF capture reinitialization cannot seek or start playback again',async t=>{
 let starts=0,release!:()=>void;
 const {speech,video}=await setup(t,{ended:true,start:async()=>{if(++starts===2)await new Promise<void>(r=>release=r);}});video.ended=false;
 const controller=new AbortController(),rejected=assert.rejects(speech.detect(controller.signal),{name:'AbortError'});
 while(!release)await tick();controller.abort();release();await rejected;
 assert.equal(video.playCalls,1);assert.deepEqual(video.seeks,[]);assert.equal(video.paused,true);
});

test('ten seconds without dialogue remain ordinary playback with no seek or fabricated sentence',async t=>{
 let clock=1000;t.mock.method(performance,'now',()=>clock);
 const {speech,video,vad}=await setup(t);video.position=0;
 const controller=new AbortController();let settled=false;
 const pending=speech.detect(controller.signal).finally(()=>{settled=true;});const rejected=assert.rejects(pending,{name:'AbortError'});await tick();
 for(let i=1;i<=320;i++){clock=1000+i*32;video.position=i*.032;await vad.processFrame(new Float32Array(512));}
 await tick();assert.equal(settled,false);assert.equal(video.paused,false);assert.equal(video.playCalls,1);assert.deepEqual(video.seeks,[]);assert.equal(video.position,10.24);
 controller.abort();await rejected;assert.equal(video.paused,true);
});

test('a short independent reply arriving during a slow review still receives its own review',async t=>{
 let emit!:(turn:{startMs:number;endMs:number;reason:'turn-end'})=>void;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){
  emit=(this as unknown as {accept:typeof emit}).accept;
 });
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',()=>undefined);
 t.mock.method(StreamingSentences.prototype,'reviewAudio',(turn:{startMs:number;endMs:number})=>({
  pcm:new Float32Array(48000).fill(turn.startMs),candidate:turn,toMedia:(ms:number)=>ms,ended:false,
 }));
 const reviewed:number[]=[];let release!:(result:Transcript|undefined)=>void;
 t.mock.method(BackgroundCaptions.prototype,'transcribe',(pcm:Float32Array)=>{
  reviewed.push(pcm[0]);
  return reviewed.length===1?new Promise<Transcript|undefined>(resolve=>{release=resolve;}):Promise.resolve(undefined);
 });
 const {speech,video,vad}=await setup(t);video.position=0;
 const controller=new AbortController();
 const rejected=assert.rejects(speech.detect(controller.signal),{name:'AbortError'});
 try{
  await tick();await vad.processFrame(new Float32Array(512));
  video.position=3;emit({startMs:1000,endMs:2000,reason:'turn-end'});await tick();
  assert.deepEqual(reviewed,[1000]);
  // On the real 02:36 search, the next estimate adjusted the onset by
  // 19 ms and the end by 1 ms. The active job already owns that audio.
  emit({startMs:1019,endMs:2001,reason:'turn-end'});await tick();
  assert.equal(video.paused,false,'a refined estimate of the active audio must not freeze the picture');
  // This reply is independent, despite ending less than 400 ms after the
  // pending review. No acoustic shortcut or accepted text can rescue it here.
  video.position=3.5;emit({startMs:2010,endMs:2250,reason:'turn-end'});await tick();
  assert.deepEqual(reviewed,[1000],'reviews remain serialized');
  assert.equal(video.paused,true,'a reviewable waiting reply holds playback before it can get stale');
  const heldAt=video.position;
  release(undefined);await tick();
  assert.deepEqual(reviewed,[1000,2010],'a failed first review cannot discard the unexamined reply');
  assert.deepEqual(video.seeks,[]);assert.equal(video.paused,false);assert.equal(video.position,heldAt);assert.equal(video.playCalls,2);
 }finally{controller.abort();await rejected;}
});

type HeldTurn={startMs:number;endMs:number;reason:'turn-end'};
async function heldReview(t:import('node:test').TestContext,first:HeldTurn={startMs:1000,endMs:2000,reason:'turn-end'},second:HeldTurn={startMs:2010,endMs:2250,reason:'turn-end'}){
 let emit!:(turn:HeldTurn)=>void,accept=false;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){emit=(this as unknown as {accept:typeof emit}).accept;});
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',(turn:HeldTurn)=>accept&&turn.startMs===second.startMs?{startMs:turn.startMs,endMs:turn.endMs}:undefined);
 t.mock.method(StreamingSentences.prototype,'reviewAudio',(turn:HeldTurn)=>({pcm:new Float32Array(96000).fill(turn.startMs),candidate:turn,toMedia:(ms:number)=>ms,ended:false}));
 const reviews:{start:number;resolve:(result:Transcript|undefined)=>void}[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',(pcm:Float32Array)=>new Promise<Transcript|undefined>(resolve=>reviews.push({start:pcm[0],resolve})));
 const state=await setup(t);state.video.position=0;
 const controller=new AbortController(),phases:string[]=[];
 const pending=state.speech.detect(controller.signal,phase=>phases.push(phase));void pending.catch(()=>{});
 await tick();await state.vad.processFrame(new Float32Array(512));
 state.video.position=(first.endMs+1000)/1000;emit(first);await tick();
 state.video.position=Math.max(state.video.position,(second.endMs+1250)/1000);emit(second);await tick();
 assert.equal(state.video.paused,true);assert.equal(reviews.length,1);
 return {...state,controller,pending,reviews,phases,emit,first,second,accept:()=>{accept=true;}};
}

test('held review drains every queued reply and resumes at exactly the held media position',async t=>{
 const s=await heldReview(t),at=s.video.position;
 try{
  s.reviews[0].resolve(undefined);await tick();assert.equal(s.reviews.length,2);assert.equal(s.video.paused,true);
  assert.equal(s.video.playCalls,1,'the next queued decode must finish before playback resumes');
  s.reviews[1].resolve(undefined);await tick();await tick();
  assert.equal(s.video.paused,false);assert.equal(s.video.position,at);assert.deepEqual(s.video.seeks,[]);assert.equal(s.video.playCalls,2);
 }finally{s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});}
});

test('fresh acoustic acceptance during a review hold finishes without resuming the old search',async t=>{
 const s=await heldReview(t);s.accept();s.emit(s.second);
 const boundary=await s.pending;assert.equal(boundary?.endMs,s.second.endMs);
 s.reviews[0].resolve(undefined);await tick();
 assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
});

for(const action of ['stop','hidden','user-play','user-seek','rate-change'] as const){
 test(`a ${action} during review hold cannot be undone by a late recognition result`,async t=>{
  const s=await heldReview(t);let outcome:unknown;
  void s.pending.catch(error=>{outcome=error;});
  try{
   if(action==='stop')s.controller.abort();
   if(action==='hidden'){(document as unknown as {hidden:boolean}).hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
   if(action==='user-play')await s.video.play();
   if(action==='user-seek')s.video.jump(12);
   if(action==='rate-change'){s.video.playbackRate=1.25;s.video.dispatchEvent(new Event('ratechange'));}
   await tick();await tick();
   assert.equal((outcome as Error)?.name,'AbortError','held user navigation must stop, not automatically replay the old origin');
   const calls=s.video.playCalls,position=s.video.position;
   s.reviews[0].resolve(undefined);await tick();await tick();
   assert.equal(s.video.playCalls,calls);assert.equal(s.video.position,position);assert.equal(s.video.paused,true);assert.deepEqual(s.video.seeks,[]);
  }finally{s.controller.abort();await s.pending.catch(()=>{});}
 });
}

test('aborting an awaited review-hold resume keeps late play completion paused',async t=>{
 const s=await heldReview(t);let releasePlay:(()=>void)|undefined;
 try{
  s.video.play=async()=>{s.video.playCalls++;await new Promise<void>(resolve=>{releasePlay=resolve;});s.video.paused=false;s.video.dispatchEvent(new Event('play'));};
  s.reviews[0].resolve(undefined);await tick();s.reviews[1].resolve(undefined);await tick();await tick();
  assert(releasePlay,'the queue drained and attempted a same-position resume');
  s.controller.abort();releasePlay();await assert.rejects(s.pending,{name:'AbortError'});await tick();
  assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,2);assert.deepEqual(s.video.seeks,[]);
 }finally{s.controller.abort();releasePlay?.();await s.pending.catch(()=>{});}
});

test('a completed review of unchanged voice does not restart ASR while a held queue drains',async t=>{
 const evidence=[...Array.from({length:25},(_,i)=>45+i),...Array.from({length:15},(_,i)=>91+i)];
 t.mock.method(StreamingSentences.prototype,'reviewEvidence',(turn:HeldTurn)=>({frames:turn.startMs===258?evidence:evidence.filter(i=>i>=56),focused:false}));
 const s=await heldReview(t,{startMs:258,endMs:3579,reason:'turn-end'},{startMs:1790,endMs:3757,reason:'turn-end'});
 try{
  s.reviews[0].resolve({language:'japanese',segments:[]});await tick();await tick();
  assert.equal(s.reviews.length,1,'endpoint changes with the same completed negative voice evidence need no new decode');
  assert.equal(s.video.paused,false);assert.equal(s.video.playCalls,2);assert.deepEqual(s.video.seeks,[]);
 }finally{s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});}
});

test('review hold drains pre-pause in-flight and queued PCM, rejects paused ingress, then resumes its clock',async t=>{
 let clock=1000,blockNext=false,releaseFrame!:()=>void,emit!:(turn:HeldTurn)=>void;
 t.mock.method(performance,'now',()=>clock);
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){emit=(this as unknown as {accept:typeof emit}).accept;});
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',()=>undefined);
 t.mock.method(StreamingSentences.prototype,'reviewAudio',(turn:HeldTurn)=>({pcm:new Float32Array(96000),candidate:turn,toMedia:(ms:number)=>ms,ended:false}));
 const actualPush=StreamingSentences.prototype.push,seen:number[]=[];
 t.mock.method(StreamingSentences.prototype,'push',function(this:StreamingSentences,frame:Float32Array,time:number,p=1){seen.push(frame[0]);actualPush.call(this,frame,time,p);});
 const reviews:((result:Transcript|undefined)=>void)[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',()=>new Promise<Transcript|undefined>(resolve=>reviews.push(resolve)));
 const s=await setup(t,{inference:async()=>{if(blockNext){blockNext=false;await new Promise<void>(resolve=>{releaseFrame=resolve;});}}});s.video.position=0;
 const controller=new AbortController(),pending=s.speech.detect(controller.signal);void pending.catch(()=>{});
 try{
  await tick();await s.vad.processFrame(new Float32Array(512));
  s.video.position=3;clock=4000;emit({startMs:1000,endMs:2000,reason:'turn-end'});await tick();
  blockNext=true;s.video.position=3.032;clock=4032;const inFlight=s.vad.processFrame(new Float32Array(512).fill(1));await tick();
  s.video.position=3.064;clock=4064;const queued=s.vad.processFrame(new Float32Array(512).fill(2));
  s.video.position=3.5;clock=4500;emit({startMs:2010,endMs:2250,reason:'turn-end'});await tick();assert.equal(s.video.paused,true);
  s.video.readyState=1;s.video.dispatchEvent(new Event('waiting'));
  await s.vad.processFrame(new Float32Array(512).fill(3));
  releaseFrame();await Promise.all([inFlight,queued]);
  assert.deepEqual(seen,[0,1,2],'all real PCM stamped before hold survives; paused silence does not enter');
  s.video.readyState=4;s.video.dispatchEvent(new Event('canplay'));
  reviews[0](undefined);await tick();reviews[1](undefined);await tick();await tick();
  assert.equal(s.video.paused,false);assert.equal(s.video.position,3.5);assert.deepEqual(s.video.seeks,[]);
  s.video.position=3.532;clock=4532;await s.vad.processFrame(new Float32Array(512).fill(4));await tick();
  assert.deepEqual(seen,[0,1,2,4]);assert.equal(s.video.playCalls,2);assert.deepEqual(s.video.seeks,[]);
 }finally{controller.abort();releaseFrame?.();await assert.rejects(pending,{name:'AbortError'});}
});

for(const end of ['window-expired','media-ended'] as const){
 test(`late negative reviews after ${end} distinguish a window boundary from EOF`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(StreamingSentences.prototype,'acousticBoundary',()=>undefined);
  t.mock.method(StreamingSentences.prototype,'reviewAudio',(turn:HeldTurn)=>({pcm:new Float32Array(64000),candidate:turn,toMedia:(ms:number)=>ms,ended:true}));
  const reviews:((result:Transcript|undefined)=>void)[]=[];
  t.mock.method(BackgroundCaptions.prototype,'transcribe',()=>new Promise<Transcript|undefined>(resolve=>reviews.push(resolve)));
  const {speech,video}=await setup(t);video.position=298.060;
  let flushes=0;
  t.mock.method(StreamingTurns.prototype,'finish',async function(this:StreamingTurns){
   flushes++;const accept=(this as unknown as {accept:(turn:HeldTurn)=>void}).accept;
   // Both final candidates arrive only when the window drains, as in the
   // installed Bilibili run. The close callback must await both reviews.
   accept({startMs:video.position*1000-2500,endMs:video.position*1000-2000,reason:'turn-end'});
   accept({startMs:video.position*1000-1000,endMs:video.position*1000-500,reason:'turn-end'});
  });
  const controller=new AbortController(),starts:number[]=[];let settled=false;
  const pending=speech.detect(controller.signal,phase=>{if(phase==='listening')starts.push(video.position);}).finally(()=>{settled=true;});void pending.catch(()=>{});
  try{
   await tick();video.position=end==='media-ended'?video.duration:320.737;
   if(end==='media-ended'){video.ended=true;video.dispatchEvent(new Event('ended'));}else t.mock.timers.tick(45000);
   await tick();assert.equal(reviews.length,1);assert.equal(video.paused,true);assert.equal(settled,false);
   reviews[0](undefined);await tick();assert.equal(reviews.length,2);assert.equal(settled,false);
   reviews[1]({language:'japanese',segments:[]});await tick();await tick();
   assert.equal(flushes,1);assert.deepEqual(video.seeks,[],'no unheard interval is skipped');
   if(end==='media-ended'){
    assert.equal(await pending,undefined);assert.equal(video.paused,true);assert.equal(video.playCalls,1);
   }else{
    assert.equal(settled,false,'a negative review at 5:20 is not the end of a 10:30 video');
    assert.deepEqual(starts,[298.060,320.737]);assert.equal(video.paused,false);assert.equal(video.playCalls,2);
   }
  }finally{controller.abort();await pending.catch(()=>{});}
 });
}

test('live discovery records a native buffered gap for the later replay without seeking ahead itself',async t=>{
 let clock=1000;t.mock.method(performance,'now',()=>clock);
 const {speech,adapter,video,vad}=await setup(t);video.position=0;
 Object.assign(video,{buffered:{length:2,start:(i:number)=>i===0?0:3.987868,end:(i:number)=>i===0?3.755667:630}});
 const controller=new AbortController(),pending=speech.detect(controller.signal);void pending.catch(()=>{});
 try{
  await tick();clock=4293;video.position=3.293;await vad.processFrame(new Float32Array(512));
  clock=4310;video.jump(3.987868);await tick();
  assert.equal(adapter.isKnownNativeGap(3337.280,3987.868),true);assert.deepEqual(video.seeks,[]);assert.equal(video.paused,false);
 }finally{controller.abort();await assert.rejects(pending,{name:'AbortError'});}
});

test('an acoustically accepted short turn keeps its print for late caption verification after discovery finishes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let emit!:(turn:HeldTurn)=>void,frame!:VideoFrameRequestCallback;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){emit=(this as unknown as {accept:typeof emit}).accept;});
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',(turn:HeldTurn)=>({startMs:turn.startMs,endMs:turn.endMs}));
 t.mock.method(StreamingSentences.prototype,'audioFor',()=>new Float32Array(2506*16).fill(.1));
 t.mock.method(StreamingSentences.prototype,'captionAudio',()=>({pcm:new Float32Array(2506*16),prefixMs:320,suffixMs:320,mediaStartMs:131875}));
 let review!:(result:Transcript|undefined)=>void,caption!:(result:Transcript|undefined)=>void;
 const calls:{review:boolean;timeout:number}[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',(_pcm:Float32Array,_language?:string,timeout=8000,isReview=true)=>{
  calls.push({review:isReview,timeout});return new Promise<Transcript|undefined>(resolve=>{if(isReview)review=resolve;else caption=resolve;});
 });
 t.mock.method(BackgroundCaptions.prototype,'cancelReview',()=>review?.(undefined));
 const {speech,video,vad}=await setup(t);video.position=132.195;
 Object.assign(document,{createElement:()=>({})});
 Object.assign(video,{requestVideoFrameCallback:(callback:VideoFrameRequestCallback)=>{frame=callback;return 1;},cancelVideoFrameCallback:()=>{}});
 let reading:{text:string;confidence:number;min:number}|undefined={text:'待て',confidence:.99,min:.99};
 (speech as any).visualReader={read:async()=>reading,dispose:()=>{}};
 const controller=new AbortController(),pending=speech.detect(controller.signal);void pending.catch(()=>{});
 try{
  await tick();await vad.processFrame(new Float32Array(512));
  for(const at of [132.4,132.8,133.2,133.6,133.8]){video.position=at;frame(0,{mediaTime:at} as VideoFrameCallbackMetadata);await tick();}
  video.position=134.061;emit({startMs:132195,endMs:134061,reason:'turn-end'});await tick();
  reading=undefined;video.position=134.3;frame(0,{mediaTime:134.3} as VideoFrameCallbackMetadata);await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].review,true);
  t.mock.timers.tick(4000);await tick();
  const boundary=await pending;assert.equal(boundary?.startMs,132195);assert.equal(boundary?.endMs,134061);
  assert.equal(boundary?.text,undefined);assert.ok(boundary?.caption);assert.equal(video.paused,true);assert.deepEqual(video.seeks,[]);
  assert.deepEqual(calls,[{review:true,timeout:6500},{review:false,timeout:30000}]);
  let published=false;void boundary!.caption!.then(()=>{published=true;});await tick();assert.equal(published,false);
  caption({language:'japanese',segments:[{text:'待て！',startMs:400,endMs:1300,confidence:.8,timing:'aligned',words:[{text:'待て！',startMs:400,endMs:1300}]}]});await tick();
  assert.equal(published,true);assert.equal((await boundary!.caption)?.text,'待て！');assert.equal(speech.detectedLanguage,undefined);
  assert.equal(video.playCalls,1);assert.deepEqual(video.seeks,[],'late text must never re-open discovery or skip media');
 }finally{controller.abort();await pending.catch(()=>{});}
});

async function lostPrintedWindow(){
 const {readFile}=await import('node:fs/promises');
 const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-printed-window-loss.json',import.meta.url),'utf8'));
 const visual=new VisualTurns(f.emptyWindow.origin);
 // The fixture preserves actual scan windows and screenshot times. These
 // stable-reader/voice doubles isolate retention; production target-time VAD
 // was not retained, so this test does not claim to reconstruct that classifier.
 for(const frame of f.visibleFrames){
  const at=frame.mediaSec*1000,read={text:frame.text,confidence:.99,min:.99};
  for(const ms of [at-100,at-68,at-36])visual.hear(ms,.9);
  visual.observe(at-100,read);visual.observe(at+100,read);visual.observe(at+700);
 }
 return {f,lines:visual.spokenLines()};
}

test('a later source confirmation rescues the earliest heard print across the observed NonDialogue window',async t=>{
 const {f,lines}=await lostPrintedWindow();assert.equal(lines.length,3);
 const {speech,video}=await setup(t);video.position=f.emptyWindow.origin/1000;
 (speech as any).lastBoundaryEnd=f.previousEndMs;let windows=0;
 t.mock.method(speech as any,'detectWindow',async(_signal:AbortSignal,_phase:unknown,_end:unknown,retained?:UnconfirmedVisualTurns)=>{
  if(++windows===1){retained?.remember(lines,f.emptyWindow.end);video.position=f.emptyWindow.end/1000;throw new NonDialogue(f.emptyWindow.end);}
  video.position=(f.nextBoundary.endMs+400)/1000;
  (speech as any).original.confirmFromPrintedSpeech();(speech as any).lastBoundaryEnd=f.nextBoundary.endMs;(speech as any).turnContext={future:true};
  return f.nextBoundary;
 });
 const recovered=await speech.detect(new AbortController().signal);
 assert.equal(recovered?.text,lines[0].text);assert.equal(recovered?.startMs,lines[0].startMs);assert.equal(recovered?.endMs,lines[0].endMs);
 assert.equal((speech as any).lastBoundaryEnd,lines[0].endMs);assert.equal((speech as any).turnContext,undefined);
 assert.deepEqual(video.seeks,[],'discovery never seeks past unheard video to rescue a printed line');
 // The other retained lines belong to the completed detect call. Replaying
 // from this recovered endpoint will read them again in ordinary sequence.
 assert.deepEqual(await speech.detect(new AbortController().signal),f.nextBoundary);
});

for(const invalidation of ['seek','abort','foreign-source','expired','changed-media','history-print','manual-language'] as const){
 test(`unconfirmed print cannot survive ${invalidation} between recognition windows`,async t=>{
  const {f,lines}=await lostPrintedWindow(),{speech,video}=await setup(t);video.position=f.emptyWindow.origin/1000;
  const controller=new AbortController();let windows=0;
  t.mock.method(speech as any,'detectWindow',async(_signal:AbortSignal,_phase:unknown,_end:unknown,retained?:UnconfirmedVisualTurns)=>{
   if(++windows===1){retained?.remember(lines,f.emptyWindow.end);video.position=f.emptyWindow.end/1000;throw new NonDialogue(f.emptyWindow.end);}
   if(invalidation==='seek')video.dispatchEvent(new Event('seeking'));
   if(invalidation==='abort')controller.abort();
   if(invalidation==='changed-media')video.currentSrc='blob:another-episode';
   video.position=invalidation==='expired'?(lines.at(-1)!.endMs+45001)/1000:(f.nextBoundary.endMs+400)/1000;
   if(invalidation==='foreign-source')(speech as any).original.setLanguage('en');
   else if(invalidation==='manual-language')(speech as any).original.setLanguage('ja');
   else (speech as any).original.confirmFromPrintedSpeech(invalidation!=='history-print');
   return f.nextBoundary;
  });
  if(invalidation==='abort')await assert.rejects(speech.detect(controller.signal),{name:'AbortError'});
  else assert.deepEqual(await speech.detect(controller.signal),f.nextBoundary);
  assert.deepEqual(video.seeks,[]);
 });
}

async function printedReviewBacklog(t:import('node:test').TestContext){
 const {readFile}=await import('node:fs/promises');
 const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-opening-printed-hold.json',import.meta.url),'utf8'));
 let emit!:(turn:HeldTurn)=>void,frame!:VideoFrameRequestCallback;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){emit=(this as any).accept;});
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',()=>undefined);
 t.mock.method(StreamingSentences.prototype,'audioFor',()=>new Float32Array());
 t.mock.method(StreamingSentences.prototype,'reviewAudio',(turn:HeldTurn)=>({pcm:new Float32Array(96000).fill(turn.startMs),candidate:turn,toMedia:(ms:number)=>ms,ended:false}));
 const reviews:{start:number;resolve:(result:Transcript|undefined)=>void}[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',(pcm:Float32Array)=>new Promise<Transcript|undefined>(resolve=>reviews.push({start:pcm[0],resolve})));
 const state=await setup(t);state.video.position=f.origin/1000;
 Object.assign(document,{createElement:()=>({})});
 Object.assign(state.video,{requestVideoFrameCallback:(callback:VideoFrameRequestCallback)=>{frame=callback;return 1;},cancelVideoFrameCallback:()=>{}});
 let reading:{text:string;confidence:number;min:number}|undefined={text:f.line.text,confidence:.99,min:.99};
 (state.speech as any).visualReader={read:async()=>reading,dispose:()=>{}};
 const controller=new AbortController(),pending=state.speech.detect(controller.signal);void pending.catch(()=>{});
 await tick();await state.vad.processFrame(new Float32Array(512));
 for(const at of [f.line.startMs+150,4300,4800,5300,5800,f.line.endMs-120]){
  state.video.position=at/1000;frame(0,{mediaTime:at/1000} as VideoFrameCallbackMetadata);await tick();
 }
 reading=undefined;state.video.position=(f.line.endMs+500)/1000;frame(0,{mediaTime:state.video.position} as VideoFrameCallbackMetadata);await tick();
 state.video.position=f.reviews[0].startedAt/1000;emit({...f.reviews[0],reason:'turn-end'});await tick();
 assert.equal(reviews.length,1);
 return {...state,f,emit,reviews,controller,pending};
}

test('the real common-onset proposals in one closed printed line stay queued without a false review hold',async t=>{
 const s=await printedReviewBacklog(t);
 try{
  s.video.position=s.f.holdAt/1000;s.emit({...s.f.reviews[1],reason:'turn-end'});await tick();
  assert.equal(s.video.paused,false,'one printed utterance with a longer endpoint is not yet a second queued dialogue');
  assert.equal(s.speech.detectedLanguage,undefined,'print grouping does not establish the source language');
  assert.equal(s.reviews.length,1);
  s.reviews[0].resolve(undefined);await tick();assert.equal(s.reviews.length,2,'the longer proposal still receives its original review');
  assert.equal(s.video.paused,false);s.reviews[1].resolve(undefined);await tick();
  assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
 }finally{s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});}
});

test('a distinct-onset reply is not hidden behind a same-print refinement when selecting review backpressure',async t=>{
 const s=await printedReviewBacklog(t);
 try{
  s.video.position=s.f.holdAt/1000;s.emit({...s.f.reviews[1],reason:'turn-end'});await tick();
  // The trace's third crop is disjoint from the active first crop. Print alone
  // cannot establish that a distinct-onset short reply is the same sound.
  s.emit({...s.f.reviews[2],reason:'turn-end'});await tick();assert.equal(s.video.paused,true);
  const heldAt=s.video.position;s.reviews[0].resolve(undefined);await tick();assert.equal(s.reviews.length,2);
  s.reviews[1].resolve(undefined);await tick();assert.equal(s.reviews.length,3);
  s.reviews[2].resolve(undefined);await tick();await tick();
  assert.equal(s.video.paused,false);assert.equal(s.video.position,heldAt);assert.deepEqual(s.video.seeks,[]);
 }finally{s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});}
});
