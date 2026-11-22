import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {MicVAD} from '@ricky0123/vad-web';
import {LiveSpeech} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
import {StreamingTurns} from '../src/turn-model';
import {StreamingSentences} from '../src/streaming-sentences';
import {BackgroundCaptions, type Transcript} from '../src/background-captions';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const transcript:Transcript={language:'japanese',segments:[{text:'こんにちは',startMs:0,endMs:1000,confidence:.9}]};
class Video extends EventTarget {
 duration=200;currentSrc='blob:visual-close';playbackRate=1;paused=true;seeking=false;isConnected=true;ended=false;readyState=4;error=null;
 position=156.965;playCalls=0;seeks:number[]=[];frame?:VideoFrameRequestCallback;
 get currentTime(){return this.position;}
 set currentTime(value:number){this.seeks.push(value);this.position=value;}
 pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
 async play(){this.playCalls++;this.paused=false;this.dispatchEvent(new Event('play'));}
 requestVideoFrameCallback(callback:VideoFrameRequestCallback){this.frame=callback;return 1;}
 cancelVideoFrameCallback(){this.frame=undefined;}
}
async function setup(t:TestContext,finish?:(tracker:StreamingTurns)=>Promise<void>){
 let cleanup=async()=>{};t.after(()=>cleanup());
 const traces:any[]=[];
 t.mock.method(console,'debug',(...values:unknown[])=>{if(values[0]==='[声格分句诊断]')traces.push(JSON.parse(String(values[1])));});
 t.mock.timers.enable({apis:['setTimeout']});
 class Context {sampleRate=16000;state='suspended';async resume(){this.state='running';}async close(){this.state='closed';}}
 for(const [key,value] of Object.entries({AudioContext:Context,document:Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null,createElement:()=>({})}),window:new EventTarget(),location:new URL('https://example.test/')})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);});
 }
 t.mock.method(MicVAD,'new',async()=>({processFrame:async()=>{},start:async()=>{},pause:async()=>{},destroy:async()=>{}} as unknown as MicVAD));
 t.mock.method(StreamingTurns.prototype,'finish',async function(this:StreamingTurns){await finish?.(this);});
 t.mock.method(StreamingSentences.prototype,'audioFor',()=>new Float32Array(16000).fill(.1));
 const checks:{timeout:number;resolve:(result:Transcript|undefined)=>void}[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',(_pcm:Float32Array,_language?:string,timeout=8000)=>new Promise<Transcript|undefined>(resolve=>{
  const timer=setTimeout(()=>resolve(undefined),timeout);
  checks.push({timeout,resolve:result=>{clearTimeout(timer);resolve(result);}});
 }));
 const cancel=t.mock.method(BackgroundCaptions.prototype,'cancelReview',()=>{});
 const video=new Video(),adapter=new VideoAdapter(video as unknown as HTMLVideoElement,'bilibili:visual-close');
 const speech=new LiveSpeech(adapter,async()=>({}),{analyze:async()=>({decision:undefined,frames:[]}),dispose:()=>{}});
 let reading:{text:string;confidence:number;min:number}|undefined={text:'こんにちは',confidence:.99,min:.99};
 (speech as any).visualReader={read:async()=>reading,dispose:()=>{}};
 const controller=new AbortController(),starts:number[]=[];let settled=false;
 const pending=speech.detect(controller.signal,phase=>{if(phase==='listening')starts.push(video.position);}).finally(()=>{settled=true;});void pending.catch(()=>{});
 cleanup=async()=>{controller.abort();await pending.catch(()=>{});speech.dispose();adapter.dispose();};
 await tick();t.mock.timers.tick(44000);
 // A stable printed line has already played, then disappears. Quiet VAD does
 // not establish its language; the same-time audio check is still in flight.
 for(const at of [157.2,157.45,157.7,158.25]){
  if(at===158.25)reading=undefined;
  video.position=at;video.frame!(0,{mediaTime:at} as VideoFrameCallbackMetadata);await tick();
 }
 assert.equal(checks.length,1);assert.equal(checks[0].timeout,6500);
 const close=async(end:'window-expired'|'media-ended')=>{
  video.position=end==='media-ended'?video.duration:182.870;
  if(end==='media-ended'){video.ended=true;video.dispatchEvent(new Event('ended'));}else t.mock.timers.tick(1000);
  await tick();
 };
 return {video,speech,checks,cancel,controller,pending,starts,close,traces,settled:()=>settled,setReading:(value:typeof reading)=>{reading=value;}};
}

for(const end of ['window-expired','media-ended'] as const){
 test(`a printed-dialogue check already running at ${end} can still complete that window`,async t=>{
  const s=await setup(t);await s.close(end);
  assert.equal(s.video.paused,true,'the deadline still stops further playback');
  assert.equal(s.settled(),false);assert.equal(s.cancel.mock.callCount(),0);
  s.checks[0].resolve(transcript);
  const boundary=await s.pending;
  assert.equal(boundary?.text,'こんにちは');assert.equal(boundary?.language,'ja');
  assert.ok(boundary!.startMs>=156965&&boundary!.endMs<=158250);
  assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,1);
  const check=s.traces[0].visualChecks[0];
  assert.equal(check.startMs+s.traces[0].origin,157050);assert.equal(check.endMs+s.traces[0].origin,157820);
  assert.equal(check.outcome,'matched');assert.ok(check.completedWallElapsedMs>=check.requestedWallElapsedMs);
 });
 test(`a negative printed-dialogue check after ${end} finishes without hanging or skipping`,async t=>{
  const s=await setup(t);await s.close(end);
  assert.equal(s.settled(),false);assert.equal(s.video.paused,true);
  s.checks[0].resolve(undefined);await tick();await tick();
  if(end==='media-ended'){
   assert.equal(await s.pending,undefined);assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);
  }else{
   assert.equal(s.settled(),false);assert.deepEqual(s.starts,[156.965,182.870]);assert.equal(s.video.paused,false);assert.equal(s.video.playCalls,2);
  }
  assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,1);
  assert.equal(s.traces[0].visualChecks[0].outcome,'no-result');
 });
}

test('a negative visual check cannot close a window while the turn-model flush is still running',async t=>{
 let drained!:()=>void;
 const s=await setup(t,()=>new Promise<void>(resolve=>{drained=resolve;}));await s.close('window-expired');
 s.checks[0].resolve(undefined);await tick();
 assert.equal(s.settled(),false);assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);
 drained();await tick();await tick();
 assert.deepEqual(s.starts,[156.965,182.870]);assert.deepEqual(s.video.seeks,[]);
});

test('the existing visual-check deadline releases a paused empty window without another decode',async t=>{
 const s=await setup(t);await s.close('window-expired');
 t.mock.timers.tick(5499);await tick();assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);
 t.mock.timers.tick(1);await tick();await tick();
 assert.deepEqual(s.starts,[156.965,182.870]);assert.equal(s.video.paused,false);assert.equal(s.checks.length,1);assert.deepEqual(s.video.seeks,[]);
});

test('an accepted visual result is not replaced when a slower final flush completes later',async t=>{
 let drained!:()=>void;
 const s=await setup(t,()=>new Promise<void>(resolve=>{drained=resolve;}));await s.close('media-ended');
 s.checks[0].resolve(transcript);const boundary=await s.pending;
 assert.equal(boundary?.text,'こんにちは');assert.equal(s.video.paused,true);
 drained();await tick();
 assert.equal(await s.pending,boundary);assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,1);
});

test('a rejected visual check resumes an acoustic candidate queued by the final flush',async t=>{
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',(turn:{startMs:number;endMs:number})=>({startMs:turn.startMs,endMs:turn.endMs}));
 const s=await setup(t,async tracker=>{(tracker as any).accept({startMs:180000,endMs:181000,reason:'turn-end'});});
 await s.close('window-expired');assert.equal(s.settled(),false);assert.equal(s.video.paused,true);
 s.checks[0].resolve(undefined);const boundary=await s.pending;
 assert.equal(boundary?.startMs,179520);assert.equal(boundary?.endMs,181000);
 assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
 assert.ok(boundary?.caption);assert.equal(s.checks.length,1,'the failed printed line is not decoded again');
});

test('abort while a drained window awaits visual verification ignores its late result',async t=>{
 const s=await setup(t);await s.close('window-expired');
 s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});
 assert.equal(s.cancel.mock.callCount(),1);
 const traceSnapshot=JSON.stringify(s.traces);
 assert.equal(s.traces[0].visualChecks[0].outcome,'window-cancelled');
 s.checks[0].resolve(transcript);await tick();
 assert.equal(s.speech.detectedLanguage,undefined);assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
 assert.equal(JSON.stringify(s.traces),traceSnapshot,'a late matched result cannot replace cancellation or emit a second trace');
});

const negativeVisualResults:Array<[string,Transcript]>=[
 ['non-japanese',{...transcript,language:'english'}],
 ['language-unavailable',{...transcript,language:undefined}],
 ['empty-result',{language:'japanese',segments:[]}],
 ['low-confidence',{...transcript,segments:[{...transcript.segments[0],confidence:.59}]}],
 ['text-mismatch',{...transcript,segments:[{...transcript.segments[0],text:'別の言葉です'}]}],
];
for(const [outcome,result] of negativeVisualResults){
 test(`visual check logs ${outcome} at EOF without changing acceptance or adding a decode`,async t=>{
  const s=await setup(t);await s.close('media-ended');
  s.checks[0].resolve(result);assert.equal(await s.pending,undefined);
  assert.equal(s.traces[0].visualChecks[0].outcome,outcome);
  assert.equal(s.speech.detectedLanguage,undefined);assert.equal(s.checks.length,1);
  assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
  assert(!JSON.stringify(s.traces).includes('こんにちは'));assert(!JSON.stringify(s.traces).includes('別の言葉です'));
 });
}

for(const priorPending of [true,false]){
 test(`a new closed printed line records ${priorPending?'busy':'cooldown'} against its own interval without another request`,async t=>{
  const s=await setup(t);
  if(!priorPending){s.checks[0].resolve(undefined);await tick();}
  s.setReading({text:'別の言葉です',confidence:.99,min:.99});
  for(const at of [159.1,159.35,159.6,160.15]){
   if(at===160.15)s.setReading(undefined);
   s.video.position=at;s.video.frame!(0,{mediaTime:at} as VideoFrameCallbackMetadata);await tick();
  }
  assert.equal(s.checks.length,1);
  await s.close('media-ended');
  if(priorPending)s.checks[0].resolve(undefined);
  assert.equal(await s.pending,undefined);
  const trace=s.traces[0],checks=trace.visualChecks;
  assert.equal(checks.length,2);assert.equal(checks[0].outcome,'no-result');
  assert.equal(checks[1].startMs+trace.origin,158950);assert.equal(checks[1].endMs+trace.origin,159720);
  assert.equal(checks[1].notRequested,priorPending?'busy':'cooldown');assert.equal(checks[1].requestedWallElapsedMs,undefined);
  assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
 });
}

for(const earlierHadVoice of [true,false]){
 test(`continuous windows ${earlierHadVoice?'restore heard':'do not restore silent'} earlier print after independent later audio agrees`,async t=>{
  let firstFlush=true;
  const s=await setup(t,async tracker=>{
   if(firstFlush&&earlierHadVoice)(tracker as any).observe([157200,157232,157264].map(at=>({atMs:at-156965,speaker:0,confidence:.9})),false);
   firstFlush=false;
  });
  await s.close('window-expired');s.checks[0].resolve(undefined);await tick();await tick();
  assert.deepEqual(s.starts,[156.965,182.870]);assert.equal(s.speech.detectedLanguage,undefined);
  s.setReading({text:'どうしようどうしよう',confidence:.99,min:.99});
  for(const at of [193.61,193.9,194.2,194.75]){
   if(at===194.75)s.setReading(undefined);
   s.video.position=at;s.video.frame!(0,{mediaTime:at} as VideoFrameCallbackMetadata);await tick();
  }
  assert.equal(s.checks.length,2);
  s.checks[1].resolve({language:'japanese',segments:[{text:'どうしようどうしよう',startMs:0,endMs:1000,confidence:.9}]});
  const boundary=await s.pending;
  assert.equal(boundary?.text,earlierHadVoice?'こんにちは':'どうしようどうしよう');
  assert.equal(boundary?.startMs,earlierHadVoice?157050:193460);
  assert.equal((s.speech as any).lastBoundaryEnd,boundary!.endMs);
  assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,2);assert.deepEqual(s.video.seeks,[]);
 });
}
